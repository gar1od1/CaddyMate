/** Play view (docs/SPEC.md §5.2–§5.6). */
import {
  playerConditionModel,
  type Club,
  type CourseBundle,
  type Round,
  type Shot,
  type StoredConditionPattern,
} from '@caddymate/api';
import {
  initialBearingDeg,
  type ClubPattern,
  type ConditionModelV1,
  type Handedness,
  type LatLng,
} from '@caddymate/engine';
import { colors, radius, spacing, type } from '@caddymate/ui';
import type { CameraStop } from '@maplibre/maplibre-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { AimPicker } from '@/components/play/AimPicker';
import { DistanceHeader } from '@/components/play/DistanceHeader';
import { HoleMap } from '@/components/play/HoleMap';
import { PostShotBanner } from '@/components/play/PostShotBanner';
import { ClubChips, PreShotCard } from '@/components/play/PreShotCard';
import { PuttCard } from '@/components/play/PuttCard';
import { RecommendationCard } from '@/components/play/RecommendationCard';
import { ShotEditor } from '@/components/play/ShotEditor';
import { ShotList } from '@/components/play/ShotList';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { setPin } from '@/data/actions';
import {
  useClubPatterns,
  useClubs,
  useConditionPatterns,
  useCourseBundle,
  useHoleScores,
  useProfile,
  useRound,
  useRoundShots,
} from '@/data/hooks';
import * as local from '@/data/local';
import { hydrateRound } from '@/data/sync';
import { usePlay } from '@/features/play/usePlay';
import { useAuth } from '@/lib/auth';

function holeBounds(bundle: CourseBundle, round: Round, hole: number) {
  const h = bundle.holes.find((x) => x.number === hole);
  if (!h) return null;
  const tee = bundle.teeSets
    .find((t) => t.id === round.teeSetId)
    ?.markers.find((m) => m.holeId === h.id)?.point;
  const pts: LatLng[] = [
    ...(tee ? [tee] : []),
    ...(h.lineOfPlay ?? []),
    ...(h.green?.outer ?? []),
    ...(h.greenCentre ? [h.greenCentre] : []),
  ];
  if (!pts.length) return null;
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const from = tee ?? h.lineOfPlay?.[0] ?? null;
  const to = h.greenCentre;
  return {
    bounds: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)] as [
      number,
      number,
      number,
      number,
    ],
    lineBearing: from && to ? initialBearingDeg(from, to) : 0,
  };
}

function firstOpenHole(bundle: CourseBundle, shots: readonly Shot[]): number {
  const holed = new Set(shots.filter((s) => s.holed).map((s) => s.holeNumber));
  return bundle.holes.find((h) => !holed.has(h.number))?.number ?? bundle.holes[0]?.number ?? 1;
}

export default function PlayScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const round = useRound(id);
  const bundle = useCourseBundle(round.data?.courseId, round.data?.courseVersion);
  const clubs = useClubs();
  const shots = useRoundShots(id);
  const userId = session?.user.id ?? round.data?.userId;
  const profile = useProfile(userId);
  const patterns = useClubPatterns();
  const conditionPatterns = useConditionPatterns();
  const patternMap = useMemo(
    () => new Map<string, ClubPattern>((patterns.data ?? []).map((p) => [p.clubId, p.params])),
    [patterns.data],
  );
  // The learned condition model (decision 007), resolved once per profile.
  const conditionModel = useMemo(() => playerConditionModel(profile.data), [profile.data]);
  const [hole, setHole] = useState<number | null>(null);

  useEffect(() => {
    void hydrateRound(id).catch(() => undefined);
  }, [id]);

  // Resume on the last hole viewed, else the first hole not yet holed.
  useEffect(() => {
    if (hole !== null || !bundle.data || !shots.data) return;
    const b = bundle.data;
    const s = shots.data;
    void local.kvGet<number>(`hole:${id}`).then((saved) => setHole(saved ?? firstOpenHole(b, s)));
  }, [hole, bundle.data, shots.data, id]);

  useEffect(() => {
    if (hole !== null) void local.kvSet(`hole:${id}`, hole);
  }, [hole, id]);

  if (!round.data || !bundle.data || hole === null || !shots.data) {
    return (
      <View style={styles.center}>
        {round.data === null ? (
          <Text style={styles.muted}>Round not found on this device.</Text>
        ) : bundle.error ? (
          <Text style={styles.muted}>{bundle.error.message}</Text>
        ) : (
          <ActivityIndicator color={colors.accent} />
        )}
      </View>
    );
  }

  return (
    <Play
      round={round.data}
      bundle={bundle.data}
      clubs={clubs.data ?? []}
      shots={shots.data}
      hole={hole}
      setHole={setHole}
      userId={userId ?? round.data.userId}
      patterns={patternMap}
      conditionPatterns={conditionPatterns.data ?? []}
      handedness={profile.data?.handedness ?? 'R'}
      conditionModel={conditionModel}
      handicapIndex={round.data.handicapIndexUsed ?? profile.data?.handicapIndexOfficial ?? null}
    />
  );
}

function Play(props: {
  round: Round;
  bundle: CourseBundle;
  clubs: Club[];
  shots: Shot[];
  hole: number;
  setHole: (n: number) => void;
  userId: string;
  patterns: ReadonlyMap<string, ClubPattern>;
  conditionPatterns: readonly StoredConditionPattern[];
  handedness: Handedness;
  conditionModel: ConditionModelV1;
  handicapIndex: number | null;
}) {
  const { round, bundle, clubs, hole, setHole } = props;
  const play = usePlay({
    round,
    bundle,
    clubs,
    shots: props.shots,
    holeNumber: hole,
    userId: props.userId,
    patterns: props.patterns,
    conditionPatterns: props.conditionPatterns,
    handedness: props.handedness,
    conditionModel: props.conditionModel,
    handicapIndex: props.handicapIndex,
  });
  const scores = useHoleScores(round.id);
  const [lineUp, setLineUp] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [aimPicker, setAimPicker] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => setSelected(null), [hole]);

  const holeNumbers = bundle.holes.map((h) => h.number);
  const idx = holeNumbers.indexOf(hole);
  const goto = (d: -1 | 1) => {
    const n = holeNumbers[idx + d];
    if (n !== undefined) setHole(n);
  };

  const fit = useMemo(() => holeBounds(bundle, round, hole), [bundle, round, hole]);
  const camera = useMemo<CameraStop>(
    () =>
      fit
        ? {
            bounds: fit.bounds,
            bearing: lineUp ? fit.lineBearing : 0,
            padding: { top: 230, bottom: 300, left: 40, right: 40 },
            duration: 600,
          }
        : { zoom: 15, duration: 0 },
    [fit, lineUp],
  );

  const selectedShot = play.shots.find((s) => s.id === selected);
  const score = scores.data?.find((s) => s.holeNumber === hole);
  const strokes = score ? (score.strokesOverride ?? score.strokesLogged) : 0;
  const putts = play.shots.filter((s) => s.lie === 'green');
  const lastPutt = putts.at(-1);
  const puttSuggestM = lastPutt && !lastPutt.holed ? lastPutt.puttRemainingM : play.distToPin;
  const pinOverridden = play.pinOverridden;

  const menu = () =>
    Alert.alert(`Hole ${String(hole)}`, undefined, [
      { text: 'Move pin (tap map)', onPress: () => play.setMapMode({ kind: 'pin' }) },
      ...(pinOverridden
        ? [{ text: 'Pin to green centre', onPress: () => void setPin(round, bundle, hole, null) }]
        : []),
      {
        text: 'Penalty / unplayable…',
        onPress: () =>
          Alert.alert('Penalty', 'Which relief?', [
            {
              text: 'Unplayable',
              onPress: () =>
                play.setPostShot({ shotId: play.shots.at(-1)?.id ?? '', penalty: 'unplayable' }),
            },
            {
              text: 'Lost ball / OB',
              onPress: () =>
                play.setPostShot({ shotId: play.shots.at(-1)?.id ?? '', penalty: 'ob' }),
            },
            {
              text: 'Penalty area',
              onPress: () =>
                play.setPostShot({ shotId: play.shots.at(-1)?.id ?? '', penalty: 'lateral' }),
            },
            { text: 'Cancel', style: 'cancel' },
          ]),
      },
      { text: lineUp ? 'North up' : 'Line up', onPress: () => setLineUp(!lineUp) },
      {
        text: 'Finish round',
        onPress: () => router.push({ pathname: '/round/[id]/summary', params: { id: round.id } }),
      },
      { text: 'Close', style: 'cancel' },
    ]);

  const modeBanner =
    play.mapMode.kind === 'pin'
      ? 'Tap the green to place the pin'
      : play.mapMode.kind === 'drop'
        ? 'Tap the map where you dropped'
        : play.mapMode.kind === 'move'
          ? `Tap the map to move the ${play.mapMode.which}`
          : null;

  const header = (
    <View style={styles.header}>
      <ShotList
        shots={play.shots}
        clubs={clubs}
        selectedId={selected}
        onSelect={(sid) => {
          setSelected(sid === selected ? null : sid);
          setExpanded(sid !== selected);
        }}
      />
      {play.postShot ? (
        <PostShotBanner
          shot={play.shots.find((s) => s.id === play.postShot?.shotId) ?? play.shots.at(-1)}
          penalty={play.postShot.penalty}
          onStrike={(strike) => {
            const sid = play.postShot?.shotId;
            if (sid) void play.actions.onStrike(sid, strike);
          }}
          onPenalty={(kind, drop) => void play.actions.onPenalty(kind, drop)}
          onDismiss={() => play.setPostShot(null)}
        />
      ) : null}
      {selectedShot ? null : play.done ? (
        <View style={styles.doneRow}>
          <Text style={styles.done} testID="play-hole-done">
            Holed · {strokes} strokes
            {score?.points != null ? ` · ${String(score.points)} pts` : ''}
          </Text>
          {idx < holeNumbers.length - 1 ? (
            <Button label={`Hole ${String(holeNumbers[idx + 1])} ›`} onPress={() => goto(1)} />
          ) : (
            <Button
              label="Finish round"
              onPress={() =>
                router.push({ pathname: '/round/[id]/summary', params: { id: round.id } })
              }
            />
          )}
        </View>
      ) : play.isPuttMode ? (
        <PuttCard
          suggestedM={puttSuggestM}
          puttNumber={putts.length + 1}
          busy={play.busy}
          onPutt={(d, r, rem) => void play.actions.onPutt(d, r, rem)}
          onExit={() => play.setPuttMode(false)}
        />
      ) : (
        <>
          {play.pending ? (
            <Text style={styles.inflight}>
              {play.club?.name ?? 'Shot'} in the air — walk to your ball, then tap Ball here.
            </Text>
          ) : (
            <>
              <RecommendationCard
                rec={play.rec}
                computing={play.recComputing}
                choice={play.choice}
                onAccept={play.actions.acceptOption}
              />
              <ClubChips
                clubs={clubs}
                value={play.club?.id ?? null}
                onChange={(clubId) => play.setCard((c) => ({ ...c, clubId }))}
              />
            </>
          )}
          <View style={styles.actions}>
            {!play.pending ? (
              <Button
                big
                label="Hit"
                testID="play-hit"
                busy={play.busy}
                onPress={() => void play.actions.onHit()}
              />
            ) : null}
            <Button
              big
              variant={play.pending ? 'primary' : 'secondary'}
              label="Ball here"
              testID="play-ball-here"
              busy={play.busy}
              onPress={() => void play.actions.onBallHere()}
            />
            <Button
              big
              variant="secondary"
              label="Holed"
              testID="play-holed"
              onPress={() => void play.actions.onHoled()}
            />
          </View>
        </>
      )}
    </View>
  );

  return (
    <View style={styles.screen}>
      <HoleMap
        bundle={bundle}
        hole={hole}
        camera={camera}
        cone={play.cone}
        origin={play.isPuttMode ? null : play.here}
        target={play.isPuttMode ? null : (play.aim?.target ?? null)}
        pin={play.pin}
        shots={play.shots}
        selectedShotId={selected}
        drop={null}
        onPress={play.actions.onMapPress}
        editHandles={
          selectedShot
            ? {
                start: selectedShot.start,
                end: selectedShot.holed ? null : selectedShot.end,
                onDragEnd: (which, p) => void play.actions.moveShot(selectedShot.id, which, p),
              }
            : null
        }
        onShotPress={(sid) => {
          setSelected(sid);
          setExpanded(true);
        }}
      />
      <DistanceHeader
        holeNumber={hole}
        holeCount={holeNumbers.at(-1) ?? 18}
        par={play.hole?.par ?? null}
        strokeIndex={play.strokeIndex}
        green={play.green}
        pinM={play.distToPin}
        pinOverridden={pinOverridden}
        playsLikeM={play.isPuttMode ? null : play.playsLikeM}
        targetM={play.isPuttMode ? null : play.targetM}
        targetPlaysLikeM={play.isPuttMode ? null : play.targetPlaysLikeM}
        hazards={play.hazards}
        gpsAccuracyM={play.fix?.accuracyM ?? null}
        onPrev={() => goto(-1)}
        onNext={() => goto(1)}
        onMenu={menu}
      />
      <View style={styles.fabs}>
        <Pressable style={styles.fab} onPress={() => router.back()}>
          <Text style={styles.fabText}>⌂</Text>
        </Pressable>
        <Pressable
          style={styles.fab}
          testID="play-scorecard"
          accessibilityLabel="Scorecard"
          onPress={() =>
            router.push({ pathname: '/round/[id]/scorecard', params: { id: round.id } })
          }
        >
          <Text style={styles.fabText}>▦</Text>
        </Pressable>
        <Pressable style={styles.fab} onPress={menu}>
          <Text style={styles.fabText}>⋯</Text>
        </Pressable>
      </View>
      {modeBanner ? (
        <Pressable style={styles.modeBanner} onPress={() => play.setMapMode({ kind: 'aim' })}>
          <Text style={styles.modeText}>{modeBanner} · tap here to cancel</Text>
        </Pressable>
      ) : null}
      {play.gpsDenied ? (
        <View style={styles.modeBanner}>
          <Text style={styles.modeText}>Location permission denied — shots can’t be marked.</Text>
        </View>
      ) : null}
      <View style={styles.sheetWrap}>
        <Sheet
          header={header}
          peek={0}
          max={380}
          expanded={expanded}
          onExpandedChange={setExpanded}
        >
          {selectedShot ? (
            <ShotEditor
              shot={selectedShot}
              clubs={clubs}
              onChange={(s) => void play.actions.editShot(s)}
              onMove={(which) => {
                play.setMapMode({ kind: 'move', shotId: selectedShot.id, which });
                setExpanded(false);
              }}
              onDelete={() => {
                void play.actions.deleteShot(selectedShot.id);
                setSelected(null);
              }}
              onInsert={(where) => void play.actions.insertShot(selectedShot.id, where)}
              onClose={() => {
                setSelected(null);
                setExpanded(false);
              }}
            />
          ) : play.isPuttMode || play.done ? null : (
            <PreShotCard play={play} clubs={clubs} onOpenAimPicker={() => setAimPicker(true)} />
          )}
        </Sheet>
      </View>
      <AimPicker
        visible={aimPicker}
        ball={play.here}
        hole={play.hole}
        pin={play.pin}
        green={play.green}
        onPick={play.actions.aimAtFeature}
        onClose={() => setAimPicker(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  muted: { ...type.body, color: colors.textMuted },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  header: { gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm },
  inflight: { ...type.caption, color: colors.textMuted },
  doneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  done: { ...type.heading, color: colors.text },
  fabs: { position: 'absolute', right: spacing.lg, top: 250, gap: spacing.sm },
  fab: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(11, 31, 20, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  fabText: { color: colors.text, fontSize: 20 },
  modeBanner: {
    position: 'absolute',
    top: 250,
    left: spacing.lg,
    right: 72,
    backgroundColor: colors.warning,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  modeText: { ...type.caption, color: '#000', fontWeight: '700' },
});
