import { colors, radius, spacing, type } from '@caddymate/ui';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

interface Props {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
  big?: boolean;
}

export function Button({ label, onPress, variant = 'primary', disabled, busy, style, big }: Props) {
  const bg =
    variant === 'primary'
      ? colors.accent
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.surfaceMuted
          : 'transparent';
  const fg =
    variant === 'primary' ? colors.accentText : variant === 'ghost' ? colors.accent : colors.text;
  return (
    <Pressable
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        big && styles.big,
        { backgroundColor: bg },
        variant === 'ghost' && styles.ghost,
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.text, big && styles.bigText, { color: fg }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  big: { paddingVertical: spacing.lg, flex: 1 },
  ghost: { paddingHorizontal: spacing.sm },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  text: { ...type.body, fontWeight: '700' },
  bigText: { fontSize: 18, fontWeight: '800' },
});
