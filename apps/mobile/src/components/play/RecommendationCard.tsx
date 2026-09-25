/**
 * Strategy recommendation (docs/SPEC.md §9.4): the top option as one line
 * ("7i — aim 9 yds left of pin. 61 % green, 9 % bunker, 0.19 strokes better
 * than at the pin."), one tap to accept it onto the pre-shot card, the
 * alternatives on demand, and the live score of whatever is on the card.
 */
import type { Recommendation, StrategyOption } from '@caddymate/engine';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { describeChoice, describeOption } from '@/features/play/recommendation';

interface Props {
  rec: Recommendation | null;
  computing: boolean;
  /** The card's current (club, aim) scored on the same basis. */
  choice: StrategyOption | null;
  onAccept: (o: StrategyOption) => void;
}

const sameOption = (a: StrategyOption | null, b: StrategyOption | null) =>
  !!a &&
  !!b &&
  a.clubId === b.clubId &&
  Math.abs(a.aim.lat - b.aim.lat) < 1e-6 &&
  Math.abs(a.aim.lng - b.aim.lng) < 1e-6;

export function RecommendationCard({ rec, computing, choice, onAccept }: Props) {
  const [open, setOpen] = useState(false);
  if (!rec) {
    return computing ? (
      <View style={[styles.card, styles.row]}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={styles.muted}>Working out the best play…</Text>
      </View>
    ) : null;
  }
  const top = rec.options[0];
  if (!top) return null;
  const onCard = sameOption(choice, top);
  const alternatives = rec.options.slice(1);

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => onAccept(top)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Accept: ${describeOption(top, rec)}`}
      >
        <Text style={styles.main}>{describeOption(top, rec)}</Text>
        <Text style={[styles.accept, onCard && styles.accepted]}>{onCard ? '✓' : 'Use'}</Text>
      </Pressable>
      {choice && !onCard ? <Text style={styles.choice}>{describeChoice(choice, top)}</Text> : null}
      {alternatives.length ? (
        <Pressable onPress={() => setOpen(!open)} hitSlop={8}>
          <Text style={styles.more}>
            {open ? 'Hide alternatives' : `${String(alternatives.length)} alternatives`}
          </Text>
        </Pressable>
      ) : null}
      {open
        ? alternatives.map((o) => (
            <Pressable
              key={`${o.clubId}:${o.kind}`}
              onPress={() => onAccept(o)}
              style={({ pressed }) => [styles.alt, pressed && styles.pressed]}
            >
              <Text style={styles.altText}>{describeOption(o, rec)}</Text>
            </Pressable>
          ))
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { opacity: 0.7 },
  main: { ...type.caption, color: colors.text, fontWeight: '700', flex: 1 },
  accept: {
    ...type.caption,
    color: colors.accentText,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    overflow: 'hidden',
    fontWeight: '800',
  },
  accepted: { backgroundColor: colors.surfaceMuted, color: colors.accent },
  choice: { ...type.caption, color: colors.textMuted },
  more: { ...type.caption, color: colors.info },
  alt: { paddingVertical: 4 },
  altText: { ...type.caption, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
});
