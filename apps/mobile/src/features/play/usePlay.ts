/**
 * State and actions for the play view (docs/SPEC.md §5.2–§5.6, §8.7, §9.4).
 * Reads the round, course and shots from the local store, watches GPS, keeps
 * the pre-shot card state, draws the conditioned pattern of the selected
 * club, runs the strategy search for the ball position, and turns button
 * presses into `shotOps` + `saveHole`.
 */
import {
  defaultAimPoint,
  effectivePattern,
  featureAnchor,
  greenDistances,
  hazardsAlongLine,
  inferLie,
  isPenaltyRecord,
  surfaceAt,
  type Club,
  type CourseBundle,
  type Hole,
  type LieKind,
  type PenaltyKind,
  type Round,
  type ShapeKind,
  type Shot,
  type StoredConditionPattern,
  type TargetRef,
} from '@caddymate/api';
import {
  FLAT_STANCE,
  feetToMetres,
  haversineDistanceM,
  initialBearingDeg,
  stanceSlopeSuggestion,
  toRecommendationSnapshot,
  type ClubPattern,
  type Handedness,
  type LatLng,
  type RecommendationSnapshot,
  type StanceSlope,
  type StrategyOption,
} from '@caddymate/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { pinFor, saveHole, setPin, strokeIndexFor } from '@/data/actions';
import { buildDispersionOverlay, currentBucketKey } from '@/lib/cone';
import { acquireShotFix, useLiveFix } from '@/lib/location';
import { elevationSampler, useCourseGrid } from '@/lib/terrain';
import { useWeather } from '@/lib/weather';
import { currentConditions, playsLike } from './conditions';
import {
  buildRecommendInput,
  evaluateCardChoice,
  recommendationKey,
  strategyClubs,
  type PositionInput,
} from './recommendation';
import * as ops from './shotOps';
import { recommendNow, useChoiceEvaluation, useRecommendation } from './useRecommendation';

export type MapMode =
  | { kind: 'aim' }
  | { kind: 'pin' }
  | { kind: 'drop'; penalty: Exclude<PenaltyKind, 'none'> }
  | { kind: 'move'; shotId: string; which: 'start' | 'end' };

export interface Aim {
  target: LatLng;
  ref: TargetRef | null;
}

/** Pre-shot card fields. `null` means "auto" (inferred / default). */
export interface Card {
  clubId: string | null;
  lie: LieKind | null;
  slope: StanceSlope;
  aim: Aim | null;
  shape: ShapeKind | null;
}

const EMPTY_CARD: Card = { clubId: null, lie: null, slope: FLAT_STANCE, aim: null, shape: null };

const samePoint = (a: LatLng | null, b: LatLng | null) =>
  !!a && !!b && Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9;

/** GPS counts as "on the course" within this distance of the hole. */
const NEAR_HOLE_M = 800;

/**
 * Club default: driver off the tee on par 4/5, otherwise the club whose stock
 * distance is closest to the distance to the pin.
 */
export function suggestClub(
  clubs: readonly Club[],
  distanceM: number | null,
  teeShotOnLongHole: boolean,
): Club | null {
  const full = clubs.filter((c) => c.active && c.kind !== 'putter' && c.stockTotalM);
  if (teeShotOnLongHole) {
    const driver = full.find((c) => c.kind === 'driver');
    if (driver) return driver;
  }
  if (distanceM === null || !full.length) return full[0] ?? null;
  return full.reduce((best, c) =>
    Math.abs((c.stockTotalM ?? 0) - distanceM) < Math.abs((best.stockTotalM ?? 0) - distanceM)
      ? c
      : best,
  );
}

export interface PostShot {
  shotId: string;
  penalty: PenaltyKind;
}

const NO_PATTERNS: ReadonlyMap<string, ClubPattern> = new Map();

export function usePlay(args: {
  round: Round;
  bundle: CourseBundle;
  clubs: readonly Club[];
  shots: readonly Shot[];
  holeNumber: number;
  userId: string;
  /** Stored neutral patterns by club id (§8.4); clubs without one use the seeded prior. */
  patterns?: ReadonlyMap<string, ClubPattern>;
  /** Stored empirical condition-bucket patterns (§8.5). */
  conditionPatterns?: readonly StoredConditionPattern[];
  handedness?: Handedness;
  /** Round's handicap index, else the profile's official one. */
  handicapIndex?: number | null;
}) {
  const { round, bundle, clubs, holeNumber, userId } = args;
  const patterns = args.patterns ?? NO_PATTERNS;
  const conditionPatterns = args.conditionPatterns;
  const handedness: Handedness = args.handedness ?? 'R';
  const handicapIndex = args.handicapIndex ?? null;
  const hole: Hole | undefined = bundle.holes.find((h) => h.number === holeNumber);
  const shots = useMemo(
    () => ops.ordered(args.shots.filter((s) => s.holeNumber === holeNumber)),
    [args.shots, holeNumber],
  );
  const base = useMemo(
    () => ({ userId, roundId: round.id, holeNumber }),
    [userId, round.id, holeNumber],
  );

  const { fix, denied } = useLiveFix();
  const [card, setCard] = useState<Card>(EMPTY_CARD);
  const [windOverride, setWindOverride] = useState<ops.WindOverride | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>({ kind: 'aim' });
  const [postShot, setPostShot] = useState<PostShot | null>(null);
  const [puttMode, setPuttMode] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  // New hole: fresh card and modes.
  useEffect(() => {
    setCard(EMPTY_CARD);
    setMapMode({ kind: 'aim' });
    setPostShot(null);
    setPuttMode(null);
  }, [holeNumber]);

  const grid = useCourseGrid(round.courseId, round.courseVersion);
  const elevAt = useMemo(() => elevationSampler(grid), [grid]);

  const tee = useMemo(() => {
    const ts = bundle.teeSets.find((t) => t.id === round.teeSetId);
    return ts?.markers.find((m) => m.holeId === hole?.id)?.point ?? null;
  }, [bundle, round.teeSetId, hole?.id]);
  const pin = pinFor(round, bundle, holeNumber);
  const strokeIndex = strokeIndexFor(round, bundle, holeNumber);
  const pending = ops.pendingShot(shots);
  const done = ops.isHoled(shots);
  const ball = ops.ballPosition(shots, tee);

  // Reference position for distances and the cone: GPS when on this hole, else the ball.
  const gpsNear =
    fix && (pin ?? ball) ? haversineDistanceM(fix.point, (pin ?? ball)!) < NEAR_HOLE_M : false;
  const here: LatLng | null = gpsNear && fix ? fix.point : (pending?.start ?? ball);

  const surface = here ? surfaceAt(bundle.holes, here, holeNumber) : null;
  const firstShot = shots.find((s) => !isPenaltyRecord(s));
  const onTee =
    !pending &&
    (shots.length === 0 || (samePoint(ball, firstShot?.start ?? null) && firstShot?.lie === 'tee'));
  const autoLie: LieKind = onTee
    ? 'tee'
    : here
      ? inferLie(bundle.holes, here, holeNumber)
      : 'fairway';
  const lie = card.lie ?? autoLie;
  const isPuttMode = puttMode ?? (lie === 'green' && !pending);

  const distToPin = here && pin ? haversineDistanceM(here, pin) : null;
  const autoClub = suggestClub(clubs, distToPin, onTee && (hole?.par ?? 4) >= 4);
  const putter = clubs.find((c) => c.kind === 'putter') ?? null;

  const weather = useWeather(here ?? pin, `${round.id}:${String(holeNumber)}`);
  const wind = windOverride
    ? { speedMps: windOverride.speedMps, fromDeg: windOverride.fromDeg, override: true }
    : weather
      ? { speedMps: weather.windSpeedMps, fromDeg: weather.windFromDeg, override: false }
      : null;
  const elevHere = here && elevAt ? elevAt(here) : null;
  const elevPin = pin && elevAt ? elevAt(pin) : null;

  // --- strategy (§9): searched from the ball, the stable chain position -----
  const bag = useMemo(
    () => strategyClubs(clubs, patterns, handicapIndex),
    [clubs, patterns, handicapIndex],
  );
  const recFrom = !pending && !done && !isPuttMode ? ball : null;
  const elevBall = recFrom && elevAt ? elevAt(recFrom) : null;
  const position: PositionInput | null =
    recFrom && pin && hole && lie !== 'green'
      ? {
          start: recFrom,
          startLie: lie,
          pin,
          hole,
          conditions: currentConditions(weather, windOverride, elevBall, elevPin),
          slope: card.slope,
          handedness,
          bag,
          handicapIndex,
          isTeeShot: onTee,
        }
      : null;
  const recKey = position ? recommendationKey(position) : null;
  const recInput = useMemo(
    () => (position ? buildRecommendInput(position) : null),
    // The key captures every input that changes the search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recKey],
  );
  const { rec, computing: recComputing } = useRecommendation(recInput, recInput ? recKey : null);
  const recTop = rec?.options[0] ?? null;

  // Club default: the card, else the recommendation, else by stock distance (§5.3).
  const club =
    clubs.find((c) => c.id === card.clubId) ??
    (recTop ? clubs.find((c) => c.id === recTop.clubId) : undefined) ??
    autoClub;
  const recForClub = rec && club ? (rec.options.find((o) => o.clubId === club.id) ?? null) : null;

  // Aim default: the recommendation's aim for this club, else along the line of play.
  const aim: Aim | null = useMemo(() => {
    if (card.aim) return card.aim;
    if (recForClub) return { target: recForClub.aim, ref: null };
    if (!here || !pin) return null;
    return {
      target: defaultAimPoint(here, hole?.lineOfPlay ?? null, pin, club?.stockTotalM ?? 150),
      ref: null,
    };
  }, [card.aim, recForClub, here, pin, hole?.lineOfPlay, club?.stockTotalM]);
  const bearing = here && aim ? initialBearingDeg(here, aim.target) : null;

  // The card's (club, aim) re-scored live (§9.4).
  const choice = useChoiceEvaluation(recInput, recKey, rec, club?.id ?? null, aim?.target ?? null);

  const green =
    here && hole?.greenCentre ? greenDistances(here, hole.greenCentre, hole.green) : null;
  const hazards =
    here && bearing !== null && hole
      ? hazardsAlongLine(here, bearing, hole.features, (club?.stockTotalM ?? 200) * 1.15)
      : [];

  // --- conditioned pattern of the selected club (§8.5, §8.7) ---------------
  const elevAim = aim && elevAt ? elevAt(aim.target) : null;
  const aimConditions = currentConditions(weather, windOverride, elevHere, elevAim);
  const neutralPattern = useMemo(
    () =>
      club && club.kind !== 'putter'
        ? effectivePattern(club, patterns.get(club.id), { handicapIndex })
        : null,
    [club, patterns, handicapIndex],
  );
  const bucketKey = bearing !== null ? currentBucketKey(lie, aimConditions, bearing) : null;
  const empirical =
    club && bucketKey
      ? (conditionPatterns?.find((p) => p.clubId === club.id && p.bucketKey === bucketKey) ?? null)
      : null;
  const cone =
    here && aim && club && neutralPattern && !isPuttMode
      ? buildDispersionOverlay({
          origin: here,
          aim: aim.target,
          club,
          pattern: neutralPattern,
          empirical,
          conditions: aimConditions,
          lie,
          slope: card.slope,
          handedness,
          green: hole?.green ?? null,
          greenFrontM: green?.frontM ?? null,
        })
      : null;

  // --- plays like (§17 Q4) and the terrain slope suggestion (§7.5) ---------
  const pinOverridden = !!round.pinOverrides[String(holeNumber)];
  const headlineM = pinOverridden ? distToPin : (green?.centreM ?? distToPin);
  const plArgs = { club, lie, slope: card.slope, handedness };
  const playsLikeM =
    here && pin
      ? playsLike(headlineM, {
          ...plArgs,
          bearingDeg: initialBearingDeg(here, pin),
          conditions: currentConditions(weather, windOverride, elevHere, elevPin),
        })
      : null;
  const targetM = here && aim ? haversineDistanceM(here, aim.target) : null;
  const targetPlaysLikeM = playsLike(targetM, {
    ...plArgs,
    bearingDeg: bearing,
    conditions: aimConditions,
  });
  const slopeSuggestion: StanceSlope | null = useMemo(
    () =>
      grid && here && bearing !== null && !isPuttMode
        ? stanceSlopeSuggestion(grid, here, bearing, handedness)
        : null,
    [grid, here, bearing, handedness, isPuttMode],
  );

  const cardFields = useCallback(
    (from: LatLng | null, altitude: number | null): ops.CardFields => {
      const target = aim?.target ?? null;
      const b = from && target ? initialBearingDeg(from, target) : bearing;
      // Grid heights for start and target when both are on it, else GPS altitude at the start.
      const gStart = from && elevAt ? elevAt(from) : null;
      const gEnd = target && elevAt ? elevAt(target) : null;
      const onGrid = gStart !== null && gEnd !== null;
      return {
        clubId: club?.id ?? null,
        lie,
        slope: card.slope,
        target,
        targetBearingDeg: b === null ? null : Math.round(b * 100) / 100,
        targetRef: aim?.ref ?? null,
        intendedShape: card.shape,
        conditions: ops.buildConditions(
          weather,
          windOverride,
          b,
          onGrid ? gStart : altitude,
          onGrid ? gEnd : null,
        ),
        slopeSuggested: slopeSuggestion,
      };
    },
    [
      aim,
      bearing,
      club?.id,
      lie,
      card.slope,
      card.shape,
      weather,
      windOverride,
      elevAt,
      slopeSuggestion,
    ],
  );

  /** The recommendation snapshot for Hit (§9.4): ranked options + what is on the card. */
  const snapshotForHit = (): RecommendationSnapshot | null => {
    if (!recInput || !recKey || !club) return null;
    try {
      const r = rec ?? recommendNow(recInput, recKey);
      if (!r) return null;
      const chosen = aim ? evaluateCardChoice(recInput, r, club.id, aim.target) : null;
      return toRecommendationSnapshot(r, chosen);
    } catch {
      return null;
    }
  };

  const persist = useCallback(
    async (next: readonly Shot[]) => {
      await saveHole(round, bundle, holeNumber, next);
    },
    [round, bundle, holeNumber],
  );

  const guarded = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const resetCard = () => setCard((c) => ({ ...EMPTY_CARD, slope: FLAT_STANCE, shape: c.shape }));

  // --- actions -------------------------------------------------------------

  const onHit = () =>
    guarded(async () => {
      const f = await acquireShotFix(fix);
      if (!f) return;
      setPostShot(null);
      await persist(ops.hit(shots, base, cardFields(f.point, f.altitudeM), f, snapshotForHit()));
    });

  const onBallHere = () =>
    guarded(async () => {
      const f = await acquireShotFix(fix);
      if (!f) return;
      const { shots: next, shotId } = ops.ballHere(
        shots,
        base,
        cardFields(ball, fix?.altitudeM ?? null),
        f,
        tee,
        (elevAt ? elevAt(f.point) : null) ?? f.altitudeM,
      );
      await persist(next);
      resetCard();
      const s = surfaceAt(bundle.holes, f.point, holeNumber);
      setPostShot({ shotId, penalty: s.penalty });
    });

  const onHoled = () =>
    guarded(async () => {
      await persist(ops.holed(shots, base, cardFields(ball, null), tee));
      setPostShot(null);
      resetCard();
    });

  const onPutt = (distanceFt: number, result: ops.PuttResult, remainingFt: number) =>
    guarded(async () => {
      await persist(
        ops.putt(shots, base, {
          clubId: putter?.id ?? null,
          distanceM: Math.round(feetToMetres(distanceFt) * 100) / 100,
          result,
          remainingM: Math.round(feetToMetres(remainingFt) * 100) / 100,
          pin,
          fix: gpsNear ? fix : null,
          slope: card.slope,
        }),
      );
      setPostShot(null);
      resetCard();
    });

  const onStrike = (shotId: string, strike: Shot['strike']) =>
    guarded(async () => {
      const s = shots.find((x) => x.id === shotId);
      if (s) await persist(ops.updateShot(shots, { ...s, strike }));
    });

  /** Record a penalty with a drop point (null = ask for a map tap). */
  const onPenalty = (
    kind: Exclude<PenaltyKind, 'none'>,
    drop: LatLng | 'stroke-distance' | 'gps' | null,
  ) =>
    guarded(async () => {
      let p: LatLng | null = null;
      if (drop === 'stroke-distance') p = ops.lastShotStart(shots) ?? tee;
      else if (drop === 'gps') p = (await acquireShotFix(fix))?.point ?? null;
      else p = drop;
      if (!p) {
        if (drop === null) setMapMode({ kind: 'drop', penalty: kind });
        return;
      }
      await persist(ops.penalty(shots, base, kind, p));
      setPostShot(null);
      setMapMode({ kind: 'aim' });
    });

  const onMapPress = (p: LatLng) => {
    switch (mapMode.kind) {
      case 'aim':
        setCard((c) => ({ ...c, aim: { target: p, ref: null } }));
        return;
      case 'pin':
        setMapMode({ kind: 'aim' });
        void guarded(async () => {
          await setPin(round, bundle, holeNumber, p);
        });
        return;
      case 'drop':
        void onPenalty(mapMode.penalty, p);
        return;
      case 'move': {
        const { shotId, which } = mapMode;
        setMapMode({ kind: 'aim' });
        void guarded(() =>
          persist(
            which === 'start' ? ops.moveStart(shots, shotId, p) : ops.moveEnd(shots, shotId, p),
          ),
        );
        return;
      }
    }
  };

  const editShot = (s: Shot) => guarded(() => persist(ops.updateShot(shots, s)));
  const deleteShot = (id: string) => guarded(() => persist(ops.deleteShot(shots, id)));
  const insertShot = (id: string, where: 'before' | 'after') =>
    guarded(async () => {
      const { shots: next } = ops.insertShot(shots, base, id, where, club?.id ?? null);
      await persist(next);
    });

  const aimAtFeature = (ref: TargetRef, target: LatLng) =>
    setCard((c) => ({ ...c, aim: { target, ref } }));

  /** One tap accepts a strategy option: fills club and aim on the card (§9.4). */
  const acceptOption = (o: StrategyOption) =>
    setCard((c) => ({ ...c, clubId: o.clubId, aim: { target: o.aim, ref: null } }));

  /** One tap confirms the terrain slope suggestion (§7.5). */
  const acceptSlope = () => {
    if (slopeSuggestion) setCard((c) => ({ ...c, slope: slopeSuggestion }));
  };

  return {
    hole,
    shots,
    tee,
    pin,
    strokeIndex,
    fix,
    gpsDenied: denied,
    here,
    ball,
    pending,
    done,
    surface,
    lie,
    autoLie,
    club,
    autoClub,
    putter,
    card,
    setCard,
    aim,
    bearing,
    green,
    hazards,
    distToPin,
    targetM,
    playsLikeM,
    targetPlaysLikeM,
    pinOverridden,
    cone,
    rec,
    recComputing,
    choice,
    slopeSuggestion,
    hasGrid: grid !== null,
    weather,
    wind,
    windOverride,
    setWindOverride,
    isPuttMode,
    setPuttMode,
    mapMode,
    setMapMode,
    postShot,
    setPostShot,
    busy,
    featureAnchor,
    actions: {
      onHit,
      onBallHere,
      onHoled,
      onPutt,
      onStrike,
      onPenalty,
      onMapPress,
      editShot,
      deleteShot,
      insertShot,
      aimAtFeature,
      acceptOption,
      acceptSlope,
    },
  };
}

export type PlayState = ReturnType<typeof usePlay>;
