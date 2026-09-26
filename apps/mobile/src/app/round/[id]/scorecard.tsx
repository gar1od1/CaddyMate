/** Scorecard (docs/SPEC.md §5.7): gross, to-par, putts, Stableford and net; tap a score to override. */
import { colors, radius, spacing, type } from '@caddymate/ui';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Section';
import { Stepper } from '@/components/ui/Stepper';
import { setStrokeOverride } from '@/data/actions';
import { useCourseBundle, useHoleScores, useRound } from '@/data/hooks';
import { buildScorecard, type CardRow, type CardTotals } from '@/features/scorecard/useScorecard';
import { toPar } from '@/lib/format';

function Row({ r, onPress }: { r: CardRow; onPress: () => void }) {
  const diff = r.strokes === null ? null : r.strokes - r.par;
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text style={[styles.cell, styles.hole]}>{r.number}</Text>
      <Text style={styles.cell}>{r.par}</Text>
      <Text style={[styles.cell, styles.faint]}>{r.strokeIndex ?? '–'}</Text>
      <View style={styles.cell}>
        <Text
          testID={`scorecard-strokes-${String(r.number)}`}
          style={[
            styles.score,
            diff !== null && diff < 0 && styles.under,
            diff !== null && diff > 0 && styles.over,
          ]}
        >
          {r.strokes ?? '–'}
          {r.overridden ? '*' : ''}
        </Text>
      </View>
      <Text style={styles.cell}>{r.putts ?? '–'}</Text>
      <Text style={styles.cell}>{r.net ?? '–'}</Text>
      <Text style={[styles.cell, styles.points]}>{r.points ?? '–'}</Text>
    </Pressable>
  );
}

function TotalRow({ label, t }: { label: string; t: CardTotals }) {
  return (
    <View style={[styles.row, styles.totalRow]}>
      <Text style={[styles.cell, styles.hole]}>{label}</Text>
      <Text style={styles.cell}>{t.par}</Text>
      <Text style={styles.cell} />
      <Text style={[styles.cell, styles.score]}>{t.holes ? t.strokes : '–'}</Text>
      <Text style={styles.cell}>{t.holes ? t.putts : '–'}</Text>
      <Text style={styles.cell}>{t.holes ? t.net : '–'}</Text>
      <Text style={[styles.cell, styles.points]}>{t.holes ? t.points : '–'}</Text>
    </View>
  );
}

export default function ScorecardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const round = useRound(id);
  const bundle = useCourseBundle(round.data?.courseId, round.data?.courseVersion);
  const scores = useHoleScores(id);
  const [editing, setEditing] = useState<CardRow | null>(null);
  const [value, setValue] = useState(4);
  const [reason, setReason] = useState('');

  if (!round.data || !bundle.data) return <View style={styles.screen} />;
  const card = buildScorecard(round.data, bundle.data, scores.data ?? []);
  const r = round.data;
  const b = bundle.data;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
    >
      <View style={styles.summary}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{card.total.holes ? card.total.strokes : '–'}</Text>
          <Text style={styles.statLabel}>GROSS</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{card.total.holes ? toPar(card.total.toPar) : '–'}</Text>
          <Text style={styles.statLabel}>TO PAR</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statValue, { color: colors.accent }]}>{card.total.points}</Text>
          <Text style={styles.statLabel}>POINTS</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{card.total.putts}</Text>
          <Text style={styles.statLabel}>PUTTS</Text>
        </View>
      </View>
      <Text style={styles.caption}>
        Playing handicap {card.playingHandicap ?? '–'} (95 % of course handicap{' '}
        {r.courseHandicap ?? '–'}) · tap a hole to correct its score
      </Text>
      <Card style={{ padding: spacing.sm, gap: 0 }}>
        <View style={[styles.row, styles.headRow]}>
          {['Hole', 'Par', 'SI', 'Score', 'Putts', 'Net', 'Pts'].map((h) => (
            <Text key={h} style={[styles.cell, styles.head]}>
              {h}
            </Text>
          ))}
        </View>
        {card.rows
          .filter((row) => row.number <= 9)
          .map((row) => (
            <Row
              key={row.number}
              r={row}
              onPress={() => {
                setEditing(row);
                setValue(row.strokes ?? row.par);
                setReason('');
              }}
            />
          ))}
        <TotalRow label="Out" t={card.out} />
        {card.rows
          .filter((row) => row.number > 9)
          .map((row) => (
            <Row
              key={row.number}
              r={row}
              onPress={() => {
                setEditing(row);
                setValue(row.strokes ?? row.par);
                setReason('');
              }}
            />
          ))}
        {card.rows.some((row) => row.number > 9) ? <TotalRow label="In" t={card.in} /> : null}
        <TotalRow label="Total" t={card.total} />
      </Card>

      <Modal
        visible={!!editing}
        transparent
        animationType="fade"
        onRequestClose={() => setEditing(null)}
      >
        <View style={styles.backdrop}>
          <Card style={{ gap: spacing.lg }}>
            <Text style={styles.title}>Hole {editing?.number} score</Text>
            <Text style={styles.caption}>
              Overrides the logged strokes (e.g. a shot wasn’t recorded). Logged shots are kept.
            </Text>
            <Stepper value={value} min={1} max={15} onChange={setValue} />
            <TextInput
              style={styles.input}
              value={reason}
              onChangeText={setReason}
              placeholder="Reason"
              placeholderTextColor={colors.textFaint}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm }}>
              {editing?.overridden ? (
                <Button
                  variant="ghost"
                  label="Clear override"
                  onPress={() => {
                    if (editing) void setStrokeOverride(r, b, editing.number, null, null);
                    setEditing(null);
                  }}
                />
              ) : null}
              <Button variant="ghost" label="Cancel" onPress={() => setEditing(null)} />
              <Button
                label="Save"
                onPress={() => {
                  if (editing)
                    void setStrokeOverride(r, b, editing.number, value, reason || 'manual');
                  setEditing(null);
                }}
              />
            </View>
          </Card>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  summary: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 34, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.2 },
  caption: { ...type.caption, color: colors.textMuted },
  title: { ...type.title, color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headRow: { borderBottomWidth: 1 },
  totalRow: { backgroundColor: colors.surfaceMuted, borderRadius: radius.sm },
  cell: { flex: 1, textAlign: 'center', color: colors.text, ...type.body, alignItems: 'center' },
  head: { ...type.caption, color: colors.textMuted },
  hole: { fontWeight: '800' },
  faint: { color: colors.textFaint },
  score: { fontWeight: '800', color: colors.text, fontSize: 17, textAlign: 'center' },
  under: { color: colors.accent },
  over: { color: colors.warning },
  points: { color: colors.accent, fontWeight: '700' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  input: {
    backgroundColor: colors.bgElevated,
    color: colors.text,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
