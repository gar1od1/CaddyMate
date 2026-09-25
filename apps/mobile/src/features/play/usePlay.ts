/**
 * State and actions for the play view (docs/SPEC.md §5.2–§5.6). Reads the
 * round, course and shots from the local store, watches GPS, keeps the
 * pre-shot card state, and turns button presses into `shotOps` + `saveHole`.
 */
import {
  defaultAimPoint,
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
  type TargetRef,
} from '@caddymate/api';
import {
  FLAT_STANCE,
  feetToMetres,
  haversineDistanceM,
  initialBearingDeg,
  type LatLng,
  type StanceSlope,
} from '@caddymate/engine';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { pinFor, saveHole, setPin, strokeIndexFor } from '@/data/actions';
import { placeholderCone } from '@/lib/cone';
import { acquireShotFix, useLiveFix } from '@/lib/location';
import { useWeather } from '@/lib/weather';
import * as ops from './shotOps';

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

export function usePlay(args: {
  round: Round;
  bundle: CourseBundle;
  clubs: readonly Club[];
  shots: readonly Shot[];
  holeNumber: number;
  userId: string;
}) {
  const { round, bundle, clubs, holeNumber, userId } = args;
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
  const club = clubs.find((c) => c.id === card.clubId) ?? autoClub;
  const putter = clubs.find((c) => c.kind === 'putter') ?? null;

  const aim: Aim | null = useMemo(() => {
    if (card.aim) return card.aim;
    if (!here || !pin) return null;
    return {
      target: defaultAimPoint(here, hole?.lineOfPlay ?? null, pin, club?.stockTotalM ?? 150),
      ref: null,
    };
  }, [card.aim, here, pin, hole?.lineOfPlay, club?.stockTotalM]);
  const bearing = here && aim ? initialBearingDeg(here, aim.target) : null;

  const green =
    here && hole?.greenCentre ? greenDistances(here, hole.greenCentre, hole.green) : null;
  const hazards =
    here && bearing !== null && hole
      ? hazardsAlongLine(here, bearing, hole.features, (club?.stockTotalM ?? 200) * 1.15)
      : [];

  // TODO(wave-2): replace with engine pattern (see lib/cone.ts).
  const cone =
    here && bearing !== null && club?.stockTotalM && !isPuttMode
      ? placeholderCone(here, bearing, club.stockTotalM)
      : null;

  const weather = useWeather(here ?? pin, `${round.id}:${String(holeNumber)}`);
  const wind = windOverride
    ? { speedMps: windOverride.speedMps, fromDeg: windOverride.fromDeg, override: true }
    : weather
      ? { speedMps: weather.windSpeedMps, fromDeg: weather.windFromDeg, override: false }
      : null;

  const cardFields = useCallback(
    (from: LatLng | null, altitude: number | null): ops.CardFields => {
      const target = aim?.target ?? null;
      const b = from && target ? initialBearingDeg(from, target) : bearing;
      return {
        clubId: club?.id ?? null,
        lie,
        slope: card.slope,
        target,
        targetBearingDeg: b === null ? null : Math.round(b * 100) / 100,
        targetRef: aim?.ref ?? null,
        intendedShape: card.shape,
        conditions: ops.buildConditions(weather, windOverride, b, altitude),
      };
    },
    [aim, bearing, club?.id, lie, card.slope, card.shape, weather, windOverride],
  );

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
      await persist(ops.hit(shots, base, cardFields(f.point, f.altitudeM), f));
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
    cone,
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
    },
  };
}

export type PlayState = ReturnType<typeof usePlay>;
