/** Wind read-out along the intended line, with a manual override (docs/SPEC.md §5.3). */
import { windComponents } from '@caddymate/api';
import { mphToMps, mpsToMph } from '@caddymate/engine';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Section';
import { Stepper } from '@/components/ui/Stepper';
import type { WindOverride } from '@/features/play/shotOps';
import { compass, mph } from '@/lib/format';

interface Props {
  wind: { speedMps: number; fromDeg: number; override: boolean } | null;
  bearingDeg: number | null;
  onOverride: (w: WindOverride | null) => void;
}

export function WindReadout({ wind, bearingDeg, onOverride }: Props) {
  const [open, setOpen] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [from, setFrom] = useState(270);
  const comps =
    wind && bearingDeg !== null ? windComponents(wind.speedMps, wind.fromDeg, bearingDeg) : null;

  return (
    <>
      <Pressable
        style={styles.row}
        onPress={() => {
          if (wind) {
            setSpeed(Math.round(mpsToMph(wind.speedMps)));
            setFrom(Math.round(wind.fromDeg / 15) * 15);
          }
          setOpen(true);
        }}
      >
        <View
          style={[
            styles.arrow,
            wind && { transform: [{ rotate: `${String(wind.fromDeg + 180)}deg` }] },
          ]}
        >
          <Text style={styles.arrowText}>↑</Text>
        </View>
        <Text style={styles.text}>
          {wind
            ? `${mph(wind.speedMps)} mph from ${compass(wind.fromDeg)}${wind.override ? ' (manual)' : ''}`
            : 'Wind loading…'}
        </Text>
        {comps ? (
          <Text style={styles.comps}>
            {comps.headMps >= 0 ? 'Into ' : 'Down '}
            {mph(Math.abs(comps.headMps))} · {comps.crossMps >= 0 ? 'L→R ' : 'R→L '}
            {mph(Math.abs(comps.crossMps))}
          </Text>
        ) : null}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Card style={styles.modal}>
            <Text style={styles.title}>Wind override</Text>
            <Stepper label="Speed" value={speed} unit="mph" min={0} max={60} onChange={setSpeed} />
            <Stepper
              label="From"
              value={from}
              step={15}
              min={0}
              max={345}
              format={(v) => `${compass(v)} ${String(v)}°`}
              onChange={setFrom}
            />
            <View style={styles.actions}>
              <Button
                variant="ghost"
                label="Use forecast"
                onPress={() => {
                  onOverride(null);
                  setOpen(false);
                }}
              />
              <Button
                label="Set"
                onPress={() => {
                  onOverride({ speedMps: mphToMps(speed), fromDeg: from });
                  setOpen(false);
                }}
              />
            </View>
          </Card>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  arrow: { width: 24, alignItems: 'center' },
  arrowText: { color: colors.info, fontSize: 20, fontWeight: '900' },
  text: { ...type.caption, color: colors.text, flex: 1 },
  comps: { ...type.caption, color: colors.textMuted },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  modal: { gap: spacing.lg },
  title: { ...type.title, color: colors.text },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
