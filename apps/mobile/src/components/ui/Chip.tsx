import { colors, radius, spacing, type } from '@caddymate/ui';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: 'accent' | 'warning' | 'danger' | 'info';
  subtle?: string;
}

export function Chip({ label, selected, onPress, tone = 'accent', subtle }: ChipProps) {
  const toneColor = colors[tone];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: toneColor, borderColor: toneColor },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
      {subtle ? (
        <Text style={[styles.subtle, selected && styles.labelSelected]}>{subtle}</Text>
      ) : null}
    </Pressable>
  );
}

interface ChipOption<T extends string> {
  value: T;
  label: string;
  subtle?: string;
}

interface ChipRowProps<T extends string> {
  options: readonly ChipOption<T>[];
  value: T | null;
  onChange: (v: T) => void;
  scroll?: boolean;
  tone?: ChipProps['tone'];
}

/** Single-select chip row; horizontally scrollable for long lists (club picker). */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  scroll,
  tone,
}: ChipRowProps<T>) {
  const chips = options.map((o) => (
    <Chip
      key={o.value}
      label={o.label}
      subtle={o.subtle}
      selected={o.value === value}
      onPress={() => onChange(o.value)}
      tone={tone}
    />
  ));
  return scroll ? (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {chips}
    </ScrollView>
  ) : (
    <View style={[styles.row, styles.wrap]}>{chips}</View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    minWidth: 44,
  },
  pressed: { opacity: 0.7 },
  label: { ...type.caption, color: colors.text, fontWeight: '700' },
  labelSelected: { color: colors.accentText },
  subtle: { fontSize: 11, color: colors.textMuted },
  row: { flexDirection: 'row', gap: spacing.sm, paddingVertical: 2 },
  wrap: { flexWrap: 'wrap' },
});
