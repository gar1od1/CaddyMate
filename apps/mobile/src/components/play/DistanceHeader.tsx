/** Top overlay: hole, par, SI and the big white distance numerals (yards). */
import type { GreenDistances, HazardOnLine } from '@caddymate/api';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { yd } from '@/lib/format';

const HAZARD_LABEL: Record<string, string> = {
  bunker: 'Bunker',
  water: 'Water',
  ob: 'OB',
  wooded: 'Trees',
};

interface Props {
  holeNumber: number;
  holeCount: number;
  par: number | null;
  strokeIndex: number | null;
  green: GreenDistances | null;
  pinM: number | null;
  pinOverridden: boolean;
  targetM: number | null;
  hazards: readonly HazardOnLine[];
  gpsAccuracyM: number | null;
  onPrev: () => void;
  onNext: () => void;
  onMenu: () => void;
}

export function DistanceHeader(p: Props) {
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        <Pressable onPress={p.onPrev} hitSlop={12} disabled={p.holeNumber <= 1}>
          <Text style={[styles.nav, p.holeNumber <= 1 && styles.navOff]}>‹</Text>
        </Pressable>
        <Pressable onPress={p.onMenu} style={styles.holeInfo}>
          <Text style={styles.hole}>Hole {p.holeNumber}</Text>
          <Text style={styles.meta}>
            Par {p.par ?? '–'}
            {p.strokeIndex !== null ? ` · SI ${String(p.strokeIndex)}` : ''}
            {p.gpsAccuracyM !== null ? ` · GPS ±${String(Math.round(p.gpsAccuracyM))} m` : ''}
          </Text>
        </Pressable>
        <Pressable onPress={p.onNext} hitSlop={12} disabled={p.holeNumber >= p.holeCount}>
          <Text style={[styles.nav, p.holeNumber >= p.holeCount && styles.navOff]}>›</Text>
        </Pressable>
      </View>
      <View style={styles.numbers}>
        <View style={styles.side}>
          <Text style={styles.small}>{yd(p.green?.backM)}</Text>
          <Text style={styles.label}>BACK</Text>
        </View>
        <View style={styles.centre}>
          <Text style={styles.big}>{yd(p.pinOverridden ? p.pinM : p.green?.centreM)}</Text>
          <Text style={styles.label}>{p.pinOverridden ? 'PIN' : 'CENTRE'}</Text>
        </View>
        <View style={styles.side}>
          <Text style={styles.small}>{yd(p.green?.frontM)}</Text>
          <Text style={styles.label}>FRONT</Text>
        </View>
      </View>
      <View style={styles.extras}>
        {p.pinOverridden ? <Text style={styles.extra}>Centre {yd(p.green?.centreM)}</Text> : null}
        {p.targetM !== null ? <Text style={styles.extra}>Target {yd(p.targetM)}</Text> : null}
        {p.hazards.slice(0, 3).map((h) => (
          <Text key={h.feature.id} style={[styles.extra, styles.hazard]}>
            {HAZARD_LABEL[h.feature.kind] ?? h.feature.kind} {yd(h.nearM)}–{yd(h.farM)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const shadow = {
  textShadowColor: 'rgba(0,0,0,0.85)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
};

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: spacing.xxl + spacing.md },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.lg,
    backgroundColor: 'rgba(11, 31, 20, 0.82)',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  nav: { fontSize: 34, color: colors.text, fontWeight: '300', paddingHorizontal: spacing.sm },
  navOff: { opacity: 0.25 },
  holeInfo: { alignItems: 'center' },
  hole: { ...type.heading, color: colors.text, fontWeight: '800' },
  meta: { ...type.caption, color: colors.textMuted },
  numbers: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: spacing.xl,
    marginTop: spacing.sm,
  },
  side: { alignItems: 'center', minWidth: 56 },
  centre: { alignItems: 'center' },
  big: { ...type.distance, fontSize: 64, color: colors.text, ...shadow },
  small: { fontSize: 26, fontWeight: '800', color: colors.text, ...shadow },
  label: { fontSize: 11, fontWeight: '800', color: colors.text, letterSpacing: 1.2, ...shadow },
  extras: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  extra: {
    ...type.caption,
    color: colors.text,
    backgroundColor: 'rgba(11, 31, 20, 0.75)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  hazard: { color: colors.warning },
});
