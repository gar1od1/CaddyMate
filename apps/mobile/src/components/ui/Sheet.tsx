/**
 * Bottom sheet with two snap states (peek / expanded), toggled by tapping or
 * dragging the handle. Hand-rolled on RN Animated to avoid another native
 * dependency; enough for a thumb-reachable card over the map.
 */
import { colors, radius, spacing } from '@caddymate/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';

interface Props {
  children: ReactNode;
  /** Always-visible content above the scrollable body (actions). */
  header?: ReactNode;
  /** Height of the collapsed body in px (header always shows). */
  peek?: number;
  /** Maximum expanded body height. */
  max?: number;
  expanded?: boolean;
  onExpandedChange?: (v: boolean) => void;
}

export function Sheet({
  children,
  header,
  peek = 0,
  max = 420,
  expanded,
  onExpandedChange,
}: Props) {
  const [open, setOpen] = useState(expanded ?? false);
  const [contentH, setContentH] = useState(max);
  const target = open ? Math.min(max, contentH) : peek;
  const height = useRef(new Animated.Value(target)).current;

  useEffect(() => {
    if (expanded !== undefined) setOpen(expanded);
  }, [expanded]);

  useEffect(() => {
    Animated.spring(height, { toValue: target, useNativeDriver: false, bounciness: 2 }).start();
  }, [height, target]);

  const setBoth = (v: boolean) => {
    setOpen(v);
    onExpandedChange?.(v);
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 8,
      onPanResponderRelease: (_e, g) => {
        if (g.dy < -20) setBoth(true);
        else if (g.dy > 20) setBoth(false);
      },
    }),
  ).current;

  return (
    <View style={styles.sheet}>
      <Pressable onPress={() => setBoth(!open)} {...pan.panHandlers} style={styles.handleArea}>
        <View style={styles.handle} />
      </Pressable>
      {header}
      <Animated.View style={{ height, overflow: 'hidden' }}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <View onLayout={(e: LayoutChangeEvent) => setContentH(e.nativeEvent.layout.height)}>
            {children}
          </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.xs },
  handle: { width: 44, height: 5, borderRadius: radius.pill, backgroundColor: colors.border },
});
