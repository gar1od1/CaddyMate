/** Four stance-slope toggles; each cycles none → mild → severe (docs/SPEC.md §5.3, §7.5). */
import type { SlopeStrength, StanceSlope } from '@caddymate/engine';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const TOGGLES: { key: keyof StanceSlope; label: string; opposite: keyof StanceSlope }[] = [
  { key: 'uphill', label: 'Uphill', opposite: 'downhill' },
  { key: 'downhill', label: 'Downhill', opposite: 'uphill' },
  { key: 'ballAboveFeet', label: 'Above feet', opposite: 'ballBelowFeet' },
  { key: 'ballBelowFeet', label: 'Below feet', opposite: 'ballAboveFeet' },
];

const NEXT: Record<SlopeStrength, SlopeStrength> = { none: 'mild', mild: 'severe', severe: 'none' };

export function SlopeToggles({
  value,
  onChange,
}: {
  value: StanceSlope;
  onChange: (v: StanceSlope) => void;
}) {
  return (
    <View style={styles.row}>
      {TOGGLES.map((t) => {
        const v = value[t.key];
        return (
          <Pressable
            key={t.key}
            style={[styles.toggle, v === 'mild' && styles.mild, v === 'severe' && styles.severe]}
            onPress={() => {
              const next = NEXT[v];
              // Uphill and downhill (above/below) are mutually exclusive.
              onChange({
                ...value,
                [t.key]: next,
                ...(next !== 'none' ? { [t.opposite]: 'none' } : {}),
              });
            }}
          >
            <Text style={[styles.label, v !== 'none' && styles.labelOn]}>{t.label}</Text>
            <Text style={[styles.level, v !== 'none' && styles.labelOn]}>
              {v === 'none' ? '—' : v}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  toggle: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  mild: { backgroundColor: colors.surfaceMuted, borderColor: colors.accent },
  severe: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { ...type.caption, color: colors.text, fontSize: 12 },
  level: { fontSize: 11, color: colors.textMuted },
  labelOn: { color: colors.text, fontWeight: '800' },
});
