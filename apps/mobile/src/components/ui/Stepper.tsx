import { colors, radius, spacing, type } from '@caddymate/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  format?: (v: number) => string;
  label?: string;
}

export function Stepper({
  value,
  onChange,
  step = 1,
  min = -Infinity,
  max = Infinity,
  unit,
  format,
  label,
}: Props) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v * 100) / 100)));
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={() => set(value - step)} hitSlop={8}>
          <Text style={styles.btnText}>−</Text>
        </Pressable>
        <Text style={styles.value}>
          {format ? format(value) : String(value)}
          {unit ? <Text style={styles.unit}> {unit}</Text> : null}
        </Text>
        <Pressable style={styles.btn} onPress={() => set(value + step)} hitSlop={8}>
          <Text style={styles.btnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { ...type.caption, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  btn: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: colors.text, fontSize: 22, fontWeight: '700' },
  value: { ...type.heading, color: colors.text, minWidth: 64, textAlign: 'center' },
  unit: { ...type.caption, color: colors.textMuted },
});
