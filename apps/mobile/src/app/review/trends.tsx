/**
 * Trends (docs/SPEC.md §10.1, §14): rolling SG by category over 5/10/20
 * rounds, per-hole scoring average at a course, tee-strategy comparison on
 * par 4/5s, the WHS ledger with the app's index against the official one,
 * and links to each club's dispersion evolution.
 */
import { listRoundReviews, whsLedger } from '@caddymate/api';
import { SG_CATEGORIES } from '@caddymate/engine';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CATEGORY_STYLE, LineChart, SignedBars } from '@/components/review/charts';
import { Tabs } from '@/components/review/parts';
import { ChipRow } from '@/components/ui/Chip';
import { Card, Label } from '@/components/ui/Section';
import { useClubs } from '@/data/hooks';
import {
  CATEGORY_LABEL,
  coursesPlayed,
  fmtSg,
  holeAverages,
  rollingSeries,
  teeStrategy,
} from '@/features/review/review';
import { useRemote } from '@/features/review/useReview';
import { shortDate, toPar, yd } from '@/lib/format';
import { supabase } from '@/lib/supabase';

const WINDOWS = [
  { value: '5', label: '5 rounds' },
  { value: '10', label: '10 rounds' },
  { value: '20', label: '20 rounds' },
] as const;

export default function Trends() {
  const reviews = useRemote(() => listRoundReviews(supabase, 40), []);
  const ledger = useRemote(() => whsLedger(supabase), []);
  const clubs = useClubs();
  const [win, setWin] = useState<'5' | '10' | '20'>('5');
  const summaries = useMemo(() => reviews.data ?? [], [reviews.data]);
  const courses = useMemo(() => coursesPlayed(summaries), [summaries]);
  const [courseId, setCourseId] = useState<string | null>(null);
  const course = courseId ?? courses[0]?.courseId ?? null;

  const rolling = useMemo(() => rollingSeries(summaries, Number(win)), [summaries, win]);
  const shown = rolling.slice(-20);
  const holes = useMemo(() => (course ? holeAverages(summaries, course) : []), [summaries, course]);
  const tee = useMemo(() => (course ? teeStrategy(summaries, course) : []), [summaries, course]);

  if (reviews.loading && !reviews.data) {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {reviews.error ? (
        <Text style={styles.warn}>Could not load rounds: {reviews.error.message}</Text>
      ) : null}

      <Card>
        <Label>Strokes gained per round, rolling</Label>
        <Tabs tabs={WINDOWS} value={win} onChange={setWin} />
        {shown.length ? (
          <>
            <LineChart
              series={SG_CATEGORIES.map((c) => ({
                key: c,
                label: CATEGORY_LABEL[c],
                color: CATEGORY_STYLE[c].color,
                ...(CATEGORY_STYLE[c].dash ? { dash: CATEGORY_STYLE[c].dash } : {}),
                values: shown.map((p) => p.byCategory[c]),
              }))}
              xLabels={[shortDate(shown[0]!.startedAt), shortDate(shown.at(-1)!.startedAt)]}
            />
            <Text style={styles.muted}>
              Last {win}: total {fmtSg(shown.at(-1)!.total)} per round ·{' '}
              {SG_CATEGORIES.map(
                (c) => `${c.toUpperCase()} ${fmtSg(shown.at(-1)!.byCategory[c])}`,
              ).join(' · ')}
            </Text>
          </>
        ) : (
          <Text style={styles.muted}>Finish a round to start the trend.</Text>
        )}
      </Card>

      {courses.length ? (
        <>
          {courses.length > 1 ? (
            <ChipRow
              scroll
              options={courses.map((c) => ({
                value: c.courseId,
                label: c.name,
                subtle: `${String(c.rounds)} rds`,
              }))}
              value={course}
              onChange={setCourseId}
            />
          ) : null}
          <Card>
            <Label>
              Scoring by hole · {courses.find((c) => c.courseId === course)?.name ?? ''}
            </Label>
            <View style={[styles.row, styles.head]}>
              {['#', 'Par', 'Avg', '±Par', 'SG', 'n'].map((h) => (
                <Text key={h} style={[styles.cell, styles.headText]}>
                  {h}
                </Text>
              ))}
            </View>
            {holes.map((h) => (
              <View key={h.number} style={styles.row}>
                <Text style={styles.cell}>{h.number}</Text>
                <Text style={styles.cell}>{h.par}</Text>
                <Text style={[styles.cell, styles.bold]}>{h.avgStrokes.toFixed(1)}</Text>
                <Text
                  style={[
                    styles.cell,
                    {
                      color:
                        h.avgToPar > 1
                          ? colors.danger
                          : h.avgToPar < 0.5
                            ? colors.accent
                            : colors.text,
                    },
                  ]}
                >
                  {h.avgToPar >= 0 ? '+' : ''}
                  {h.avgToPar.toFixed(1)}
                </Text>
                <Text style={styles.cell}>{fmtSg(h.avgSg, 1)}</Text>
                <Text style={[styles.cell, styles.muted]}>{h.n}</Text>
              </View>
            ))}
          </Card>
          <Card>
            <Label>Tee strategy on par 4s and 5s (actual outcomes)</Label>
            {tee.length === 0 ? (
              <Text style={styles.muted}>No tee shots on par 4/5s yet.</Text>
            ) : (
              tee.map((h) => (
                <View key={h.holeNumber} style={styles.tee}>
                  <Text style={styles.teeTitle}>
                    Hole {h.holeNumber} · par {h.par}
                  </Text>
                  {h.clubs.map((c) => (
                    <Text key={c.clubId} style={styles.body}>
                      <Text style={styles.bold}>{c.label}</Text> ×{c.n} · SG {fmtSg(c.avgSg)} ·{' '}
                      {Math.round(c.fairwayPct * 100)} % fairway
                      {c.penaltyPct > 0
                        ? ` · ${String(Math.round(c.penaltyPct * 100))} % penalty`
                        : ''}
                      {c.avgRemainingM !== null ? ` · ${yd(c.avgRemainingM)} yds left` : ''}
                      {c.recommendedPct > 0
                        ? ` · engine's pick ${String(Math.round(c.recommendedPct * 100))} %`
                        : ''}
                    </Text>
                  ))}
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}

      <Card>
        <Label>WHS ledger</Label>
        {ledger.data ? (
          <>
            <Text style={styles.body}>
              CaddyMate estimate{' '}
              <Text style={styles.bold}>{ledger.data.index?.index.toFixed(1) ?? '–'}</Text>
              {ledger.data.index?.cap !== 'none' && ledger.data.index
                ? ` (${ledger.data.index.cap} cap)`
                : ''}{' '}
              · official{' '}
              <Text style={styles.bold}>{ledger.data.official?.toFixed(1) ?? 'not set'}</Text>
            </Text>
            {ledger.data.history.length > 1 ? (
              <LineChart
                signed={false}
                dp={1}
                height={140}
                series={[
                  {
                    key: 'index',
                    label: 'Index',
                    color: colors.accent,
                    values: ledger.data.history.map((h) => h.index),
                  },
                ]}
                xLabels={[
                  shortDate(ledger.data.history[0]!.date),
                  shortDate(ledger.data.history.at(-1)!.date),
                ]}
              />
            ) : null}
            <Text style={styles.muted}>
              Last {ledger.data.entries.length} differentials; highlighted ones count
              {ledger.data.index
                ? ` (best ${String(ledger.data.index.used)}${ledger.data.index.adjustment ? `, ${String(ledger.data.index.adjustment)}` : ''})`
                : ''}
              .
            </Text>
            {ledger.data.entries.map((e) => (
              <Pressable
                key={e.roundId}
                onPress={() =>
                  router.push({ pathname: '/review/[roundId]', params: { roundId: e.roundId } })
                }
                style={[styles.ledgerRow, e.counts && styles.ledgerCounts]}
              >
                <Text style={styles.body}>{shortDate(e.date)}</Text>
                <Text style={styles.muted}>
                  {e.gross ?? '–'} / adj {e.adjustedGross ?? '–'}
                </Text>
                <Text style={[styles.body, styles.bold, e.counts && { color: colors.accent }]}>
                  {e.differential.toFixed(1)}
                </Text>
              </Pressable>
            ))}
          </>
        ) : (
          <Text style={styles.muted}>
            {ledger.loading ? 'Loading…' : (ledger.error?.message ?? 'No scores yet.')}
          </Text>
        )}
      </Card>

      <Card>
        <Label>Scores</Label>
        <SignedBars
          dp={1}
          rows={summaries
            .slice(-10)
            .reverse()
            .map((s) => ({
              key: s.roundId,
              label: shortDate(s.startedAt),
              value: s.sg.total,
              sub: `${s.totals.gross ?? '–'} (${s.totals.gross !== null ? toPar(s.totals.gross - s.totals.par) : '–'}) · ${String(s.totals.points ?? '–')} pts`,
            }))}
          onPress={(roundId) => router.push({ pathname: '/review/[roundId]', params: { roundId } })}
        />
      </Card>

      <Card>
        <Label>Dispersion by club</Label>
        <View style={styles.clubs}>
          {(clubs.data ?? [])
            .filter((c) => c.active && c.kind !== 'putter')
            .map((c) => (
              <Pressable
                key={c.id}
                style={({ pressed }) => [styles.club, pressed && { opacity: 0.7 }]}
                onPress={() =>
                  router.push({ pathname: '/review/clubs/[clubId]', params: { clubId: c.id } })
                }
              >
                <Text style={styles.clubText}>{c.name}</Text>
              </Pressable>
            ))}
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  body: { ...type.body, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
  warn: { ...type.caption, color: colors.warning },
  bold: { fontWeight: '800' },
  row: { flexDirection: 'row', paddingVertical: 3 },
  head: { borderBottomWidth: 1, borderColor: colors.border },
  headText: { color: colors.textMuted, fontWeight: '700' },
  cell: { flex: 1, textAlign: 'center', ...type.caption, color: colors.text },
  tee: { gap: 2, paddingVertical: spacing.xs, borderTopWidth: 1, borderColor: colors.border },
  teeTitle: { ...type.caption, color: colors.textMuted, fontWeight: '700' },
  ledgerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  ledgerCounts: { backgroundColor: colors.surfaceMuted },
  clubs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  club: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  clubText: { ...type.caption, color: colors.text, fontWeight: '700' },
});
