/**
 * Round replay (§14): one hole on the map with every shot's start → end
 * line, the chosen aim at Hit and the 80 % ellipse of that club (from the
 * snapshot when stored, else re-derived from the pattern around the
 * snapshot's expected landing); scrub through the shots.
 */
import type { CourseBundle, RoundReview } from '@caddymate/api';
import type { ClubPattern, LatLng } from '@caddymate/engine';
import { colors, radius, spacing, type } from '@caddymate/ui';
import type { CameraStop } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HoleMap } from '@/components/play/HoleMap';
import { Button } from '@/components/ui/Button';
import { ChipRow } from '@/components/ui/Chip';
import { fmtSg, holeView, replayShots, CATEGORY_LABEL } from '@/features/review/review';
import type { DispersionOverlay } from '@/lib/cone';
import { yd } from '@/lib/format';

const ring = (pts: readonly LatLng[]): [number, number][] => pts.map((p) => [p.lng, p.lat]);

export function Replay({
  review,
  bundle,
  patterns,
  hole,
  onHole,
  shotId,
  onShot,
}: {
  review: RoundReview;
  bundle: CourseBundle;
  patterns: ReadonlyMap<string, ClubPattern>;
  hole: number;
  onHole: (n: number) => void;
  shotId: string | null;
  onShot: (id: string | null) => void;
}) {
  const reviewHole = review.holes.find((h) => h.number === hole) ?? review.holes[0];
  const frames = useMemo(
    () => (reviewHole ? replayShots(reviewHole, patterns, review.clubLabels) : []),
    [reviewHole, patterns, review.clubLabels],
  );
  const [lineUp, setLineUp] = useState(true);
  const idx = Math.max(
    0,
    frames.findIndex((f) => f.id === shotId),
  );
  const frame = frames[idx] ?? null;

  useEffect(() => {
    if (frames.length && !frames.some((f) => f.id === shotId)) onShot(frames[0]!.id);
  }, [frames, shotId, onShot]);

  const view = useMemo(
    () =>
      reviewHole
        ? holeView(
            bundle,
            review.round,
            reviewHole.number,
            reviewHole.shots.map((r) => r.shot),
          )
        : null,
    [bundle, review.round, reviewHole],
  );
  const camera = useMemo<CameraStop>(
    () =>
      view
        ? {
            bounds: view.bounds,
            bearing: lineUp ? view.bearing : 0,
            padding: { top: 40, bottom: 40, left: 30, right: 30 },
            duration: 400,
          }
        : { zoom: 15, duration: 0 },
    [view, lineUp],
  );

  const cone = useMemo<DispersionOverlay | null>(() => {
    if (!frame?.ellipse) return null;
    const r = ring(frame.ellipse);
    const centre =
      frame.review.shot.recommendation?.chosen?.meanLanding ?? frame.aim ?? frame.ellipse[0]!;
    return {
      mode: 'ellipse',
      rings: [{ kind: 'e80', ring: r }],
      edge: r,
      centre,
      meanAlongM: 0,
      confidence: 'forming',
      dashed: frame.ellipseSource !== 'snapshot',
      empirical: false,
      label: frame.ellipseSource === 'snapshot' ? '80 % at the time' : '80 % · from pattern',
    };
  }, [frame]);

  if (!reviewHole) return <Text style={styles.muted}>No holes in this round.</Text>;
  const pin =
    review.round.pinOverrides[String(reviewHole.number)] ??
    bundle.holes.find((h) => h.number === reviewHole.number)?.greenCentre ??
    null;
  const r = frame?.review;
  const chosen = r?.shot.recommendation?.chosen ?? null;

  return (
    <View style={{ gap: spacing.sm }}>
      <ChipRow
        scroll
        options={review.holes.map((h) => ({
          value: String(h.number),
          label: String(h.number),
          subtle: h.strokes !== null ? String(h.strokes) : '–',
        }))}
        value={String(reviewHole.number)}
        onChange={(v) => {
          onShot(null);
          onHole(Number(v));
        }}
      />
      <View style={styles.map}>
        <HoleMap
          bundle={bundle}
          hole={reviewHole.number}
          camera={camera}
          cone={cone}
          origin={frame?.start ?? null}
          target={frame?.aim ?? null}
          pin={pin}
          shots={frames.map((f) => f.review.shot)}
          selectedShotId={frame?.id ?? null}
          drop={null}
          onPress={() => undefined}
          onShotPress={(id) => onShot(id)}
        />
      </View>
      <View style={styles.scrub}>
        <Button
          variant="secondary"
          label="‹"
          disabled={idx <= 0}
          onPress={() => onShot(frames[idx - 1]?.id ?? null)}
        />
        <View style={{ flex: 1 }}>
          <ChipRow
            scroll
            options={frames.map((f) => ({ value: f.id, label: String(f.seq) }))}
            value={frame?.id ?? null}
            onChange={onShot}
          />
        </View>
        <Button
          variant="secondary"
          label="›"
          disabled={idx >= frames.length - 1}
          onPress={() => onShot(frames[idx + 1]?.id ?? null)}
        />
        <Button
          variant="ghost"
          label={lineUp ? 'North' : 'Line up'}
          onPress={() => setLineUp((v) => !v)}
        />
      </View>
      {frame && r ? (
        <View style={styles.card}>
          <Text style={styles.title}>
            Shot {frame.seq}
            {frame.clubLabel ? ` · ${frame.clubLabel}` : ''}
            {r.sgCategory ? ` · ${CATEGORY_LABEL[r.sgCategory]}` : ''}
          </Text>
          <Text style={styles.body}>
            {r.shot.lie ?? '–'} {yd(r.shot.distanceToPinBeforeM)} yds →{' '}
            {r.shot.holed
              ? 'holed'
              : `${r.shot.resultSurface ?? '–'} ${yd(r.shot.distanceToPinAfterM)} yds`}
            {r.shot.penalty !== 'none' ? ` · ${r.shot.penalty}` : ''}
          </Text>
          <Text style={styles.body}>
            SG {fmtSg(r.sg)}
            {r.grade
              ? ` · decision ${r.grade.decisionGrade} (−${r.grade.strategyLoss.toFixed(2)}) · execution ${r.grade.executionGrade} (${fmtSg(r.grade.executionLoss)})`
              : ''}
          </Text>
          {chosen ? (
            <Text style={styles.muted}>
              Chosen {chosen.clubLabel}: {Math.round(chosen.pGreen * 100)} % green,{' '}
              {Math.round(chosen.pPenalty * 100)} % penalty, E {chosen.expectedStrokes.toFixed(2)}
            </Text>
          ) : (
            <Text style={styles.muted}>No recommendation snapshot for this shot.</Text>
          )}
          {r.explanation ? <Text style={styles.body}>{r.explanation}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  map: { height: 380, borderRadius: radius.lg, overflow: 'hidden' },
  scrub: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  title: { ...type.heading, color: colors.text },
  body: { ...type.body, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
});
