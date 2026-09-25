/** Small building blocks shared by the review screens: stat tiles, tabs, the 2×2. */
import type { GradeMatrix } from '@caddymate/engine';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { StyleSheet, Text, View } from 'react-native';
import { ChipRow } from '@/components/ui/Chip';

export function StatTile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.statRow}>{children}</View>;
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return <ChipRow options={tabs} value={value} onChange={onChange} scroll />;
}

/** Decision × execution 2×2 (§9.5). */
export function GradeMatrixView({ matrix }: { matrix: GradeMatrix }) {
  const cell = (n: number, label: string, good: boolean | null) => (
    <View
      style={[
        styles.cell,
        good === true && { borderColor: colors.accent },
        good === false && { borderColor: colors.danger },
      ]}
    >
      <Text style={styles.cellValue}>{n}</Text>
      <Text style={styles.cellLabel}>{label}</Text>
    </View>
  );
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={styles.matrixHead}>
        <View style={styles.axisSpacer} />
        <Text style={styles.axis}>Good execution</Text>
        <Text style={styles.axis}>Poor execution</Text>
      </View>
      <View style={styles.matrixRow}>
        <Text style={[styles.axis, styles.axisSpacer]}>Good decision</Text>
        {cell(matrix.goodDecisionGoodExecution, 'well played', true)}
        {cell(matrix.goodDecisionPoorExecution, 'right call, missed', null)}
      </View>
      <View style={styles.matrixRow}>
        <Text style={[styles.axis, styles.axisSpacer]}>Poor decision</Text>
        {cell(matrix.poorDecisionGoodExecution, 'got away with it', null)}
        {cell(matrix.poorDecisionPoorExecution, 'wrong call, missed', false)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  statRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: spacing.xs },
  stat: { alignItems: 'center', minWidth: 70 },
  statValue: { fontSize: 28, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 11, fontWeight: '800', color: colors.textMuted, letterSpacing: 1.2 },
  matrixHead: { flexDirection: 'row', gap: spacing.xs },
  matrixRow: { flexDirection: 'row', gap: spacing.xs, alignItems: 'stretch' },
  axisSpacer: { width: 72 },
  axis: {
    flex: 1,
    ...type.caption,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    alignSelf: 'center',
  },
  cell: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center',
  },
  cellValue: { fontSize: 24, fontWeight: '800', color: colors.text },
  cellLabel: { fontSize: 11, color: colors.textMuted, textAlign: 'center' },
});
