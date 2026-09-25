/** Putt card (docs/SPEC.md §5.5): distance in feet (pre-filled from GPS), result, remaining. */
import { metresToFeet } from '@caddymate/engine';
import { colors, spacing, type } from '@caddymate/ui';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { ChipRow } from '@/components/ui/Chip';
import { Field } from '@/components/ui/Section';
import { Stepper } from '@/components/ui/Stepper';
import type { PuttResult } from '@/features/play/shotOps';

interface Props {
  /** Pre-fill: previous putt's remaining distance, else GPS distance to the pin. */
  suggestedM: number | null;
  puttNumber: number;
  busy: boolean;
  onPutt: (distanceFt: number, result: PuttResult, remainingFt: number) => void;
  onExit: () => void;
}

export function PuttCard({ suggestedM, puttNumber, busy, onPutt, onExit }: Props) {
  const initial = suggestedM === null ? 15 : Math.max(1, Math.round(metresToFeet(suggestedM)));
  const [distance, setDistance] = useState(initial);
  const [result, setResult] = useState<PuttResult>('holed');
  const [remaining, setRemaining] = useState(3);

  // New putt → new pre-fill.
  useEffect(() => {
    setDistance(initial);
    setResult('holed');
    setRemaining(3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puttNumber]);

  return (
    <View style={styles.body}>
      <Text style={styles.title}>Putt {puttNumber}</Text>
      <Stepper
        label="Distance"
        value={distance}
        unit="ft"
        min={1}
        max={150}
        onChange={setDistance}
      />
      <Field label="Result">
        <ChipRow
          options={[
            { value: 'holed', label: 'Holed' },
            { value: 'short', label: 'Left short' },
            { value: 'past', label: 'Past' },
          ]}
          value={result}
          onChange={setResult}
        />
      </Field>
      {result !== 'holed' ? (
        <Stepper
          label="Remaining"
          value={remaining}
          unit="ft"
          min={1}
          max={100}
          onChange={setRemaining}
        />
      ) : null}
      <View style={styles.actions}>
        <Button variant="ghost" label="Full shot" onPress={onExit} />
        <Button
          big
          label={result === 'holed' ? 'Holed' : 'Record putt'}
          busy={busy}
          onPress={() => onPutt(distance, result, result === 'holed' ? 0 : remaining)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  title: { ...type.title, color: colors.text },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
