/**
 * Feature-relative intended line (docs/SPEC.md §4, §5.3): pick a feature
 * (bunker, tree, green edge, pin) and an offset in yards left/right and
 * short/long of it.
 */
import {
  featureAnchor,
  resolveTargetRef,
  type GreenDistances,
  type Hole,
  type TargetRef,
} from '@caddymate/api';
import {
  destinationPoint,
  haversineDistanceM,
  initialBearingDeg,
  metresToYards,
  toClubFrame,
  yardsToMetres,
  type LatLng,
} from '@caddymate/engine';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Card, Label } from '@/components/ui/Section';
import { Stepper } from '@/components/ui/Stepper';
import { yd } from '@/lib/format';

interface Option {
  key: string;
  label: string;
  ref: Omit<TargetRef, 'offsetRightM' | 'offsetLongM'>;
}

const KIND_LABEL: Record<string, string> = {
  bunker: 'Bunker',
  water: 'Water',
  tree: 'Tree',
  wooded: 'Trees',
  fairway: 'Fairway',
  hardpan: 'Hardpan',
};

function options(
  ball: LatLng,
  hole: Hole,
  pin: LatLng | null,
  green: GreenDistances | null,
): Option[] {
  const out: Option[] = [];
  if (pin) out.push({ key: 'pin', label: 'Pin', ref: { kind: 'pin', anchor: pin } });
  if (hole.greenCentre) {
    const b = initialBearingDeg(ball, hole.greenCentre);
    out.push({
      key: 'gc',
      label: 'Green centre',
      ref: { kind: 'green_centre', anchor: hole.greenCentre },
    });
    if (green) {
      out.push(
        {
          key: 'gf',
          label: 'Green front',
          ref: { kind: 'green_front', anchor: destinationPoint(ball, b, green.frontM) },
        },
        {
          key: 'gb',
          label: 'Green back',
          ref: { kind: 'green_back', anchor: destinationPoint(ball, b, green.backM) },
        },
      );
    }
  }
  const lineBearing = pin ? initialBearingDeg(ball, pin) : 0;
  for (const f of hole.features) {
    if (!KIND_LABEL[f.kind]) continue;
    const anchor = featureAnchor(f);
    if (!anchor) continue;
    const rel = toClubFrame(ball, lineBearing, anchor);
    const side = Math.abs(rel.lateralM) < 8 ? 'centre' : rel.lateralM < 0 ? 'left' : 'right';
    out.push({
      key: f.id,
      label: `${KIND_LABEL[f.kind] ?? f.kind} (${side}) ${yd(haversineDistanceM(ball, anchor))}`,
      ref: { kind: 'feature', featureId: f.id, featureKind: f.kind, anchor },
    });
  }
  return out;
}

interface Props {
  visible: boolean;
  ball: LatLng | null;
  hole: Hole | undefined;
  pin: LatLng | null;
  green: GreenDistances | null;
  onPick: (ref: TargetRef, target: LatLng) => void;
  onClose: () => void;
}

export function AimPicker({ visible, ball, hole, pin, green, onPick, onClose }: Props) {
  const opts = useMemo(
    () => (ball && hole ? options(ball, hole, pin, green) : []),
    [ball, hole, pin, green],
  );
  const [key, setKey] = useState<string | null>(null);
  const [right, setRight] = useState(0);
  const [long, setLong] = useState(0);
  const chosen = opts.find((o) => o.key === key) ?? opts[0];

  const apply = () => {
    if (!chosen || !ball) return;
    const ref: TargetRef = {
      ...chosen.ref,
      offsetRightM: yardsToMetres(right),
      offsetLongM: yardsToMetres(long),
    };
    onPick(ref, resolveTargetRef(ball, ref));
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Card style={styles.modal}>
          <Text style={styles.title}>Aim relative to…</Text>
          <ScrollView style={{ maxHeight: 240 }}>
            {opts.length === 0 ? <Text style={styles.muted}>No features on this hole.</Text> : null}
            {opts.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => setKey(o.key)}
                style={[styles.opt, chosen?.key === o.key && styles.optOn]}
              >
                <Text style={styles.optText}>{o.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Label>Offset</Label>
          <View style={styles.steppers}>
            <Stepper
              label={right === 0 ? 'Left / right' : right > 0 ? 'Right' : 'Left'}
              value={right}
              step={5}
              min={-60}
              max={60}
              format={(v) => `${String(Math.abs(v))}`}
              unit="yd"
              onChange={setRight}
            />
            <Stepper
              label={long === 0 ? 'Short / long' : long > 0 ? 'Long' : 'Short'}
              value={long}
              step={5}
              min={-60}
              max={60}
              format={(v) => `${String(Math.abs(v))}`}
              unit="yd"
              onChange={setLong}
            />
          </View>
          {chosen && ball ? (
            <Text style={styles.muted}>
              Target{' '}
              {String(
                Math.round(
                  metresToYards(
                    haversineDistanceM(
                      ball,
                      resolveTargetRef(ball, {
                        ...chosen.ref,
                        offsetRightM: yardsToMetres(right),
                        offsetLongM: yardsToMetres(long),
                      }),
                    ),
                  ),
                ),
              )}{' '}
              yd
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button variant="ghost" label="Cancel" onPress={onClose} />
            <Button label="Aim here" onPress={apply} disabled={!chosen} />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modal: { gap: spacing.md, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  title: { ...type.title, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
  opt: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: 'transparent' },
  optOn: { borderColor: colors.accent, backgroundColor: colors.surfaceMuted },
  optText: { ...type.body, color: colors.text },
  steppers: { flexDirection: 'row', justifyContent: 'space-around' },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
