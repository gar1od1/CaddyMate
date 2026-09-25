/**
 * Round review (docs/SPEC.md §9.5, §10, §14): header totals, then Replay,
 * Decisions, Strokes gained and Scorecard. Computed from the local store
 * with the same pure `buildRoundReview` that `gradeRound` writes to the DB.
 */
import { whsLedger } from '@caddymate/api';
import { SG_CATEGORIES } from '@caddymate/engine';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SignedBars } from '@/components/review/charts';
import { GradeMatrixView, StatRow, StatTile, Tabs } from '@/components/review/parts';
import { Replay } from '@/components/review/Replay';
import { Button } from '@/components/ui/Button';
import { Card, Label } from '@/components/ui/Section';
import { useCourseBundle } from '@/data/hooks';
import { CATEGORY_LABEL, fmtSg, shotTitle } from '@/features/review/review';
import { gradeRoundWhenSynced, useRemote, useRoundReview } from '@/features/review/useReview';
import { shortDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';

type Tab = 'replay' | 'decisions' | 'sg' | 'card';
const TABS: { value: Tab; label: string }[] = [
  { value: 'replay', label: 'Replay' },
  { value: 'decisions', label: 'Decisions' },
  { value: 'sg', label: 'Strokes gained' },
  { value: 'card', label: 'Scorecard' },
];

export default function RoundReviewScreen() {
  const { roundId } = useLocalSearchParams<{ roundId: string }>();
  const { review, patterns, loading } = useRoundReview(roundId);
  const bundle = useCourseBundle(review?.round.courseId, review?.round.courseVersion);
  const [tab, setTab] = useState<Tab>('replay');
  const [hole, setHole] = useState(1);
  const [shotId, setShotId] = useState<string | null>(null);
  const [gradeState, setGradeState] = useState<'idle' | 'saving' | 'saved' | 'pending' | 'failed'>(
    'idle',
  );
  const patternMap = useMemo(() => new Map(patterns.map((p) => [p.clubId, p.params])), [patterns]);
  const complete = review?.round.status === 'complete';

  const saveGrades = useCallback(() => {
    setGradeState('saving');
    gradeRoundWhenSynced(roundId)
      .then((ok) => setGradeState(ok ? 'saved' : 'pending'))
      .catch(() => setGradeState('failed'));
  }, [roundId]);

  // Persist the grades for the web dashboard / trends once the round is synced.
  useEffect(() => {
    if (complete) saveGrades();
  }, [complete, saveGrades]);

  useEffect(() => {
    const first = review?.holes[0]?.number;
    if (first !== undefined && !review?.holes.some((h) => h.number === hole)) setHole(first);
  }, [review, hole]);

  if (!review || !bundle.data) {
    return (
      <View style={[styles.screen, styles.center]}>
        {loading || bundle.loading ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <Text style={styles.muted}>Round not found on this device.</Text>
        )}
      </View>
    );
  }

  const t = review.totals;
  const g = review.roundGradingSummary.totals;
  const openShot = (holeNumber: number, id: string) => {
    setHole(holeNumber);
    setShotId(id);
    setTab('replay');
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{bundle.data.course.name}</Text>
      <Text style={styles.muted}>
        {shortDate(review.round.startedAt)} · baseline {review.baseline}
        {gradeState === 'saved'
          ? ' · grades saved'
          : gradeState === 'pending'
            ? ' · grades save after sync'
            : gradeState === 'failed'
              ? ' · grades not saved (offline?)'
              : ''}
      </Text>
      <Card>
        <StatRow>
          <StatTile label="GROSS" value={t.gross !== null ? String(t.gross) : '–'} />
          <StatTile label="NET" value={t.net !== null ? String(t.net) : '–'} />
          <StatTile label="POINTS" value={t.points !== null ? String(t.points) : '–'} />
          <StatTile
            label="SG"
            value={fmtSg(review.sgSummary.total, 1)}
            tone={review.sgSummary.total >= 0 ? colors.accent : colors.danger}
          />
        </StatRow>
      </Card>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'replay' ? (
        <Replay
          review={review}
          bundle={bundle.data}
          patterns={patternMap}
          hole={hole}
          onHole={setHole}
          shotId={shotId}
          onShot={setShotId}
        />
      ) : null}

      {tab === 'decisions' ? (
        <>
          <Card>
            <Label>Strokes lost</Label>
            <StatRow>
              <StatTile label="STRATEGY" value={g.strategyLoss.toFixed(2)} tone={colors.warning} />
              <StatTile
                label="EXECUTION"
                value={(-g.executionLoss).toFixed(2)}
                tone={g.executionLoss < 0 ? colors.danger : colors.accent}
              />
              <StatTile label="GRADED" value={String(g.count)} />
            </StatRow>
            <Text style={styles.muted}>
              Strategy = expected strokes of your choice minus the best option. Execution = how your
              shots finished against what your pattern predicted for that choice (negative is better
              than expected).
            </Text>
          </Card>
          <Card>
            <Label>Decision × execution</Label>
            {g.count ? (
              <GradeMatrixView matrix={review.matrix} />
            ) : (
              <Text style={styles.muted}>No shots with a recommendation snapshot.</Text>
            )}
          </Card>
          <Card>
            <Label>By category</Label>
            <SignedBars
              rows={SG_CATEGORIES.filter((c) => review.roundGradingSummary.byCategory[c]).map(
                (c) => {
                  const x = review.roundGradingSummary.byCategory[c]!;
                  return {
                    key: c,
                    label: CATEGORY_LABEL[c],
                    value: -x.cost,
                    sub: `strategy −${x.strategyLoss.toFixed(2)} · ${String(x.count)} shots`,
                  };
                },
              )}
            />
          </Card>
          <Card>
            <Label>Most expensive shots</Label>
            {review.mostExpensive.length === 0 ? (
              <Text style={styles.muted}>Nothing cost you more than expected. Nice.</Text>
            ) : (
              review.mostExpensive.map(({ shot, cost }) => (
                <Pressable
                  key={shot.shotId}
                  onPress={() => openShot(shot.holeNumber, shot.shotId)}
                  style={({ pressed }) => [styles.worst, pressed && { opacity: 0.7 }]}
                >
                  <View style={styles.worstHead}>
                    <Text style={styles.worstTitle}>
                      {shotTitle(shot.holeNumber, shot.seq, shot.clubLabel)}
                    </Text>
                    <Text style={styles.worstCost}>−{cost.toFixed(2)}</Text>
                  </View>
                  <Text style={styles.body}>{shot.explanation}</Text>
                </Pressable>
              ))
            )}
          </Card>
        </>
      ) : null}

      {tab === 'sg' ? (
        <>
          <Card>
            <Label>Strokes gained by category (vs {review.baseline})</Label>
            <SignedBars
              rows={SG_CATEGORIES.map((c) => ({
                key: c,
                label: CATEGORY_LABEL[c],
                value: review.sgSummary.byCategory[c],
                sub: `${String(review.sgSummary.counts[c])} shots`,
              }))}
            />
            <Text style={styles.muted}>Total {fmtSg(review.sgSummary.total)}</Text>
          </Card>
          <Card>
            <Label>Per club (tee and approach shots)</Label>
            {review.perClubSg.length ? (
              <SignedBars
                rows={review.perClubSg.map((c) => ({
                  key: c.clubId,
                  label: c.label,
                  value: c.sg,
                  sub: `${String(c.count)} shots · dispersion ›`,
                }))}
                onPress={(clubId) =>
                  router.push({ pathname: '/review/clubs/[clubId]', params: { clubId } })
                }
              />
            ) : (
              <Text style={styles.muted}>No tee or approach shots with a club.</Text>
            )}
          </Card>
          <Card>
            <Label>Per hole</Label>
            <SignedBars
              rows={review.holes.map((h) => ({
                key: String(h.number),
                label: `Hole ${String(h.number)}`,
                value: h.sg,
                sub: `par ${String(h.par)} · ${h.strokes !== null ? String(h.strokes) : '–'}`,
              }))}
              onPress={(k) => {
                setHole(Number(k));
                setShotId(null);
                setTab('replay');
              }}
            />
          </Card>
        </>
      ) : null}

      {tab === 'card' ? <ScorecardTab review={review} /> : null}

      <View style={styles.actions}>
        <Button variant="secondary" label="Trends" onPress={() => router.push('/review/trends')} />
        {complete ? (
          <Button
            variant="ghost"
            label="Save grades"
            busy={gradeState === 'saving'}
            onPress={saveGrades}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

function ScorecardTab({
  review,
}: {
  review: NonNullable<ReturnType<typeof useRoundReview>['review']>;
}) {
  const ledger = useRemote(() => whsLedger(supabase), [review.round.id]);
  const t = review.totals;
  return (
    <>
      <Card>
        <View style={[styles.cardRow, styles.cardHead]}>
          {['#', 'Par', 'Gross', 'Net', 'Pts', 'SG'].map((h) => (
            <Text key={h} style={[styles.cardCell, styles.cardHeadText]}>
              {h}
            </Text>
          ))}
        </View>
        {review.holes.map((h) => (
          <View key={h.number} style={styles.cardRow}>
            <Text style={styles.cardCell}>{h.number}</Text>
            <Text style={styles.cardCell}>{h.par}</Text>
            <Text
              style={[
                styles.cardCell,
                styles.bold,
                h.strokes !== null && h.strokes < h.par && { color: colors.accent },
                h.strokes !== null && h.strokes > h.par + 1 && { color: colors.danger },
              ]}
            >
              {h.strokes ?? '–'}
            </Text>
            <Text style={styles.cardCell}>{h.net ?? '–'}</Text>
            <Text style={styles.cardCell}>{h.points ?? '–'}</Text>
            <Text style={styles.cardCell}>{fmtSg(h.sg, 1)}</Text>
          </View>
        ))}
        <View style={[styles.cardRow, styles.cardHead]}>
          <Text style={[styles.cardCell, styles.bold]}>Tot</Text>
          <Text style={[styles.cardCell, styles.bold]}>{t.par}</Text>
          <Text style={[styles.cardCell, styles.bold]}>{t.gross ?? '–'}</Text>
          <Text style={[styles.cardCell, styles.bold]}>{t.net ?? '–'}</Text>
          <Text style={[styles.cardCell, styles.bold]}>{t.points ?? '–'}</Text>
          <Text style={[styles.cardCell, styles.bold]}>{fmtSg(review.sgSummary.total, 1)}</Text>
        </View>
      </Card>
      <Card>
        <Label>Handicap</Label>
        <Text style={styles.body}>
          Adjusted gross {t.adjustedGross ?? '–'} · differential {t.differential ?? '–'}
        </Text>
        <Text style={styles.body}>
          Playing handicap {review.round.playingHandicap ?? '–'} · index used{' '}
          {review.round.handicapIndexUsed ?? '–'}
        </Text>
        {ledger.data ? (
          <Text style={styles.body}>
            Provisional index {ledger.data.index?.index.toFixed(1) ?? '– (needs 3 scores)'}
            {ledger.data.official !== null ? ` · official ${ledger.data.official.toFixed(1)}` : ''}
          </Text>
        ) : (
          <Text style={styles.muted}>
            {ledger.loading ? 'Loading index…' : 'Index unavailable offline.'}
          </Text>
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  title: { ...type.title, color: colors.text },
  body: { ...type.body, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
  bold: { fontWeight: '800' },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
  worst: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  worstHead: { flexDirection: 'row', justifyContent: 'space-between' },
  worstTitle: { ...type.caption, color: colors.textMuted, fontWeight: '700' },
  worstCost: { ...type.caption, color: colors.danger, fontWeight: '800' },
  cardRow: { flexDirection: 'row', paddingVertical: 4 },
  cardHead: { borderBottomWidth: 1, borderColor: colors.border },
  cardHeadText: { color: colors.textMuted, fontWeight: '700' },
  cardCell: { flex: 1, textAlign: 'center', ...type.caption, color: colors.text },
});
