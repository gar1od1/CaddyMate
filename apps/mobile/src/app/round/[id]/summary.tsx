/** Round summary / finish (docs/SPEC.md §5.7 end of round). */
import { colors, spacing, type } from '@caddymate/ui';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card, Label } from '@/components/ui/Section';
import { saveRound } from '@/data/actions';
import { useCourseBundle, useHoleScores, useRound, useRoundShots } from '@/data/hooks';
import { gradeRoundWhenSynced } from '@/features/review/useReview';
import { buildScorecard, finishTotals } from '@/features/scorecard/useScorecard';
import { shortDate, toPar } from '@/lib/format';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

export default function Summary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const round = useRound(id);
  const bundle = useCourseBundle(round.data?.courseId, round.data?.courseVersion);
  const scores = useHoleScores(id);
  const shots = useRoundShots(id);
  const [busy, setBusy] = useState(false);

  if (!round.data || !bundle.data) return <View style={styles.screen} />;
  const r = round.data;
  const card = buildScorecard(r, bundle.data, scores.data ?? []);
  const t = card.total;
  const penalties = (scores.data ?? []).reduce((s, h) => s + h.penalties, 0);
  const reconstructed = (shots.data ?? []).filter((s) => s.reconstructed).length;
  const unplayed = card.rows.filter((row) => row.strokes === null).map((row) => row.number);

  const finish = (status: 'complete' | 'abandoned') => {
    setBusy(true);
    saveRound({
      ...r,
      status,
      finishedAt: new Date().toISOString(),
      // Engine scoring: Stableford, net-double-bogey adjusted gross, differential.
      ...finishTotals(card),
    })
      .then(() => {
        // Write SG and grades once the round's shots are on the server (§9.5).
        if (status === 'complete') void gradeRoundWhenSynced(r.id).catch(() => undefined);
        router.dismissTo('/');
      })
      .catch((e: unknown) => Alert.alert('Could not save', e instanceof Error ? e.message : ''))
      .finally(() => setBusy(false));
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{bundle.data.course.name}</Text>
      <Text style={styles.caption}>{shortDate(r.startedAt)}</Text>
      <Card>
        <View style={styles.stats}>
          <Stat label="GROSS" value={t.holes ? String(t.strokes) : '–'} />
          <Stat label="TO PAR" value={t.holes ? toPar(t.toPar) : '–'} />
          <Stat label="POINTS" value={String(t.points)} />
        </View>
        <View style={styles.stats}>
          <Stat label="PUTTS" value={String(t.putts)} />
          <Stat label="PENALTIES" value={String(penalties)} />
          <Stat label="NET" value={t.holes ? String(t.net) : '–'} />
        </View>
      </Card>
      <Card>
        <Label>Handicap</Label>
        <Text style={styles.body}>
          Index {r.handicapIndexUsed ?? '–'} · course {r.courseHandicap ?? '–'} · playing{' '}
          {r.playingHandicap ?? '–'}
        </Text>
        <Text style={styles.body}>
          Adjusted gross {card.adjustedGross ?? '–'} · differential {card.differential ?? '–'}
        </Text>
        {unplayed.length ? (
          <Text style={styles.warn}>
            No score on hole{unplayed.length > 1 ? 's' : ''} {unplayed.join(', ')}.
          </Text>
        ) : null}
        {reconstructed ? (
          <Text style={styles.caption}>
            {reconstructed} reconstructed shot(s) flagged for review.
          </Text>
        ) : null}
      </Card>
      <Button
        variant="secondary"
        label="Scorecard"
        onPress={() => router.push({ pathname: '/round/[id]/scorecard', params: { id } })}
      />
      {r.status === 'live' ? (
        <>
          <Button big label="Finish round" busy={busy} onPress={() => finish('complete')} />
          <Button variant="ghost" label="Abandon round" onPress={() => finish('abandoned')} />
        </>
      ) : (
        <>
          {r.status === 'complete' ? (
            <Button
              big
              label="Review round"
              onPress={() =>
                router.push({ pathname: '/review/[roundId]', params: { roundId: r.id } })
              }
            />
          ) : null}
          <Text style={styles.caption}>
            {r.status === 'complete' ? 'Round complete.' : 'Round abandoned.'}
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  title: { ...type.title, color: colors.text },
  caption: { ...type.caption, color: colors.textMuted },
  body: { ...type.body, color: colors.text },
  warn: { ...type.caption, color: colors.warning },
  stats: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.sm },
  stat: { alignItems: 'center', minWidth: 80 },
  value: { fontSize: 36, fontWeight: '800', color: colors.text },
  label: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.2 },
});
