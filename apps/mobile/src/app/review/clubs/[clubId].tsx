/**
 * Dispersion evolution for one club (docs/SPEC.md §8.4, §14): the neutral
 * shots (course filled, sim hollow) with the current 80 % ellipse, the
 * ellipse at the end of each of the last rounds overlaid, counts and
 * confidence, and the miss-tendency sentences.
 */
import {
  dispersionHistory,
  effectivePattern,
  loadPatternShots,
  missTendencies,
} from '@caddymate/api';
import { ellipsePolygon, isExcludedShot, metresToYards } from '@caddymate/engine';
import { colors, spacing, type } from '@caddymate/ui';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Legend, Scatter } from '@/components/review/charts';
import { StatRow, StatTile } from '@/components/review/parts';
import { Card, Label } from '@/components/ui/Section';
import { useClubPatterns, useClubs, useConditionPatterns } from '@/data/hooks';
import { scatterDomains } from '@/features/review/review';
import { useRemote } from '@/features/review/useReview';
import { shortDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';

export default function ClubDispersion() {
  const { clubId } = useLocalSearchParams<{ clubId: string }>();
  const clubs = useClubs();
  const stored = useClubPatterns();
  const buckets = useConditionPatterns();
  const club = clubs.data?.find((c) => c.id === clubId) ?? null;
  const shots = useRemote(() => loadPatternShots(supabase, clubId), [clubId]);
  const history = useRemote(() => dispersionHistory(supabase, clubId, { rounds: 5 }), [clubId]);

  const pattern = useMemo(() => {
    const s = stored.data?.find((p) => p.clubId === clubId)?.params;
    if (s) return s;
    return club && club.kind !== 'putter' ? effectivePattern(club, null) : null;
  }, [stored.data, club, clubId]);

  const points = useMemo(
    () =>
      (shots.data ?? [])
        .filter((s) => s.strike === 'good' && !isExcludedShot(s))
        .map((s) => ({
          x: s.lateralM,
          y: s.alongM,
          kind: s.source === 'sim' ? ('sim' as const) : ('course' as const),
        })),
    [shots.data],
  );
  const rings = useMemo(() => {
    const out: {
      key: string;
      points: { x: number; y: number }[];
      color: string;
      dash?: string;
      opacity?: number;
      width?: number;
    }[] = [];
    const hist = history.data ?? [];
    hist.forEach((h, i) =>
      out.push({
        key: h.roundId,
        points: ellipsePolygon(h.pattern, 0.8).map((p) => ({ x: p.lateralM, y: p.alongM })),
        color: colors.textMuted,
        dash: '3,3',
        opacity: 0.35 + (0.5 * (i + 1)) / Math.max(1, hist.length),
        width: 1,
      }),
    );
    if (pattern) {
      out.push({
        key: 'current',
        points: ellipsePolygon(pattern, 0.8).map((p) => ({ x: p.lateralM, y: p.alongM })),
        color: colors.accent,
        width: 2,
        ...(pattern.confidence !== 'established' ? { dash: '6,3' } : {}),
      });
    }
    return out;
  }, [history.data, pattern]);

  const domains = useMemo(
    () =>
      scatterDomains(
        points.map((p) => ({ alongM: p.y, lateralM: p.x })),
        rings.map((r) => r.points.map((p) => ({ alongM: p.y, lateralM: p.x }))),
      ),
    [points, rings],
  );

  const tendencies = useMemo(
    () =>
      pattern
        ? missTendencies(
            [{ clubId, params: pattern }],
            (buckets.data ?? []).filter((b) => b.clubId === clubId),
            { labels: club ? { [clubId]: club.name } : {} },
          )
        : [],
    [pattern, buckets.data, clubId, club],
  );

  const ydsLabel = (m: number) => String(Math.round(metresToYards(m)));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: club ? `${club.name} dispersion` : 'Dispersion' }} />
      {pattern ? (
        <Card>
          <StatRow>
            <StatTile label="TOTAL YDS" value={`${ydsLabel(pattern.distance.mean)}`} />
            <StatTile label="± YDS" value={ydsLabel(pattern.distance.sd)} />
            <StatTile
              label="BIAS"
              value={`${ydsLabel(Math.abs(pattern.lateral.mean))}${pattern.lateral.mean >= 0 ? 'R' : 'L'}`}
            />
          </StatRow>
          <Text style={styles.muted}>
            {pattern.confidence} · {Math.round(pattern.n_effective)} effective shots of{' '}
            {pattern.n_raw} ({pattern.n_course} course, {pattern.n_sim} sim) + 8 seeded ·{' '}
            {Math.round(pattern.miss.p_miss * 100)} % mishits
          </Text>
        </Card>
      ) : (
        <Text style={styles.muted}>
          {club?.kind === 'putter' ? 'Putters have no pattern.' : ''}
        </Text>
      )}

      <Card>
        <Label>Neutral shots, yds (right →, longer ↑)</Label>
        <Scatter points={points} rings={rings} x={domains.x} y={domains.y} axisLabel={ydsLabel} />
        <Legend
          items={[
            { key: 'cur', label: 'Current 80 %', color: colors.accent },
            { key: 'hist', label: 'End of past rounds', color: colors.textMuted, dash: '3,3' },
          ]}
        />
        <View style={styles.keys}>
          <View style={[styles.dot, { backgroundColor: colors.warning }]} />
          <Text style={styles.muted}>course</Text>
          <View style={[styles.dot, styles.hollow]} />
          <Text style={styles.muted}>sim</Text>
          <Text style={styles.muted}>· {points.length} shots</Text>
        </View>
        {shots.error ? <Text style={styles.warn}>{shots.error.message}</Text> : null}
      </Card>

      <Card>
        <Label>Evolution (last rounds)</Label>
        {(history.data ?? []).length === 0 ? (
          <Text style={styles.muted}>
            {history.loading ? 'Loading…' : 'No completed rounds yet.'}
          </Text>
        ) : (
          (history.data ?? []).map((h) => (
            <View key={h.roundId} style={styles.histRow}>
              <Text style={styles.body}>{shortDate(h.finishedAt)}</Text>
              <Text style={styles.muted}>
                {ydsLabel(h.pattern.distance.mean)} ± {ydsLabel(h.pattern.distance.sd)} yds · bias{' '}
                {ydsLabel(Math.abs(h.pattern.lateral.mean))}
                {h.pattern.lateral.mean >= 0 ? 'R' : 'L'} · n {Math.round(h.pattern.n_effective)} ·{' '}
                {h.pattern.confidence}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card>
        <Label>Miss tendencies</Label>
        {tendencies.length ? (
          tendencies.map((t) => (
            <Text key={t} style={styles.body}>
              • {t}
            </Text>
          ))
        ) : (
          <Text style={styles.muted}>
            No clear tendency yet (needs ≥ 60 % one way over 8+ shots).
          </Text>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  body: { ...type.body, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
  warn: { ...type.caption, color: colors.warning },
  keys: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  hollow: { borderWidth: 1.5, borderColor: colors.info },
  histRow: { gap: 2, paddingVertical: 2 },
});
