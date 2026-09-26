/**
 * After Ball here (docs/SPEC.md §5.4): optional strike-quality chips for the
 * shot just finished and, when it finished in a penalty area / OB, the
 * relief options that create a penalty record.
 */
import type { PenaltyKind, Shot, StrikeKind } from '@caddymate/api';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { reliefOptions, type ReliefDrop, type ReliefKind } from '@/features/play/shotOps';

const STRIKES: { value: StrikeKind; label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'fat', label: 'Fat' },
  { value: 'thin', label: 'Thin' },
  { value: 'toe', label: 'Toe' },
  { value: 'heel', label: 'Heel' },
  { value: 'top', label: 'Top' },
  { value: 'shank', label: 'Shank' },
];

type Relief = ReliefKind;
type Drop = ReliefDrop;

const PENALTY_TITLE: Record<Relief, string> = {
  lateral: 'Red penalty area',
  yellow: 'Yellow penalty area',
  ob: 'Out of bounds',
  unplayable: 'Unplayable',
};

export function PenaltyOptions({
  kind,
  onPick,
}: {
  kind: Relief;
  onPick: (kind: Relief, drop: Drop) => void;
}) {
  return (
    <View style={styles.penalty}>
      <Text style={styles.penaltyTitle}>{PENALTY_TITLE[kind]} · +1 stroke</Text>
      <View style={styles.wrap}>
        {reliefOptions(kind).map((o) => (
          <Chip key={o.label} label={o.label} tone="danger" onPress={() => onPick(kind, o.drop)} />
        ))}
      </View>
    </View>
  );
}

interface Props {
  shot: Shot | undefined;
  penalty: PenaltyKind;
  onStrike: (s: StrikeKind) => void;
  onPenalty: (kind: Relief, drop: Drop) => void;
  onDismiss: () => void;
}

export function PostShotBanner({ shot, penalty, onStrike, onPenalty, onDismiss }: Props) {
  if (!shot) return null;
  return (
    <View style={styles.banner}>
      <View style={styles.head}>
        <Text style={styles.title}>How was shot {shot.seq}?</Text>
        <Pressable onPress={onDismiss} hitSlop={10}>
          <Text style={styles.close}>✕</Text>
        </Pressable>
      </View>
      <ChipRow
        scroll
        options={STRIKES}
        value={shot.strike}
        onChange={onStrike}
        tone={shot.strike === 'good' ? 'accent' : 'warning'}
      />
      {penalty !== 'none' ? <PenaltyOptions kind={penalty} onPick={onPenalty} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { ...type.caption, color: colors.text, fontWeight: '700' },
  close: { color: colors.textMuted, fontSize: 16 },
  penalty: { gap: spacing.sm, marginTop: spacing.xs },
  penaltyTitle: { ...type.caption, color: colors.danger, fontWeight: '800' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
