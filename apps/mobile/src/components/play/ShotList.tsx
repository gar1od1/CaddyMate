/** This hole's shots under the map (docs/SPEC.md §5.6); tap one to edit. */
import { isPenaltyRecord, type Club, type Shot } from '@caddymate/api';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ft, yd } from '@/lib/format';

const PENALTY_LABEL: Record<string, string> = {
  lateral: 'Penalty (red)',
  yellow: 'Penalty (yellow)',
  ob: 'Penalty (OB)',
  unplayable: 'Penalty (unplayable)',
};

export function shotLabel(s: Shot, clubs: readonly Club[]): string {
  if (isPenaltyRecord(s)) return PENALTY_LABEL[s.penalty] ?? 'Penalty';
  return clubs.find((c) => c.id === s.clubId)?.name ?? 'Shot';
}

export function shotResult(s: Shot): string {
  if (isPenaltyRecord(s)) return '+1';
  if (s.lie === 'green' && s.puttDistanceM !== null) {
    return s.holed
      ? `${ft(s.puttDistanceM)} ft · holed`
      : `${ft(s.puttDistanceM)} → ${ft(s.puttRemainingM)} ft`;
  }
  if (s.holed) return 'Holed';
  if (s.observedDistanceM === null) return s.start && !s.end ? 'In flight' : '–';
  const lat = s.observedLateralM ?? 0;
  const side = Math.abs(lat) < 0.5 ? '' : ` ${yd(Math.abs(lat))}${lat > 0 ? 'R' : 'L'}`;
  return `${yd(s.observedDistanceM)} yd${side}`;
}

interface Props {
  shots: readonly Shot[];
  clubs: readonly Club[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ShotList({ shots, clubs, selectedId, onSelect }: Props) {
  if (!shots.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {shots.map((s) => (
        <Pressable
          key={s.id}
          onPress={() => onSelect(s.id)}
          style={[
            styles.item,
            s.id === selectedId && styles.selected,
            isPenaltyRecord(s) && styles.penalty,
          ]}
        >
          <Text style={styles.seq}>{s.seq}</Text>
          <View>
            <Text style={styles.club}>
              {shotLabel(s, clubs)}
              {s.reconstructed ? ' *' : ''}
              {s.strike !== 'good' ? ` · ${s.strike}` : ''}
            </Text>
            <Text style={styles.result}>{shotResult(s)}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selected: { borderColor: colors.accent },
  penalty: { borderColor: colors.danger },
  seq: { fontSize: 20, fontWeight: '800', color: colors.warning },
  club: { ...type.caption, color: colors.text, fontWeight: '700' },
  result: { ...type.caption, color: colors.textMuted },
});
