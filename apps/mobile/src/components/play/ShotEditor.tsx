/**
 * Edit one shot (docs/SPEC.md §5.6): change club / lie / slope / strike /
 * putt feet, move its start or end on the map, delete, insert before/after.
 * Every save goes through saveHole → recomputeHoleShots.
 */
import { isPenaltyRecord, type Club, type Shot } from '@caddymate/api';
import { feetToMetres, metresToFeet } from '@caddymate/engine';
import { colors, spacing, type } from '@caddymate/ui';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Field } from '@/components/ui/Section';
import { Stepper } from '@/components/ui/Stepper';
import { ClubChips, LIES } from './PreShotCard';
import { SlopeToggles } from './SlopeToggles';
import { shotLabel, shotResult } from './ShotList';

interface Props {
  shot: Shot;
  clubs: readonly Club[];
  onChange: (s: Shot) => void;
  onMove: (which: 'start' | 'end') => void;
  onDelete: () => void;
  onInsert: (where: 'before' | 'after') => void;
  onClose: () => void;
}

export function ShotEditor({ shot, clubs, onChange, onMove, onDelete, onInsert, onClose }: Props) {
  const penaltyRecord = isPenaltyRecord(shot);
  const putt = shot.lie === 'green';
  return (
    <View style={styles.body}>
      <View style={styles.head}>
        <Text style={styles.title}>
          Shot {shot.seq} · {shotLabel(shot, clubs)}
        </Text>
        <Text style={styles.muted}>{shotResult(shot)}</Text>
      </View>
      {shot.reconstructed ? (
        <Text style={styles.warn}>Reconstructed (Hit was skipped) — check the fields below.</Text>
      ) : null}
      {!penaltyRecord ? (
        <>
          <Field label="Club">
            <ClubChips
              clubs={clubs}
              value={shot.clubId}
              onChange={(clubId) => onChange({ ...shot, clubId })}
            />
          </Field>
          <Field label="Lie">
            <ChipRow
              scroll
              options={LIES}
              value={shot.lie}
              onChange={(lie) => onChange({ ...shot, lie })}
            />
          </Field>
          {putt ? (
            <View style={styles.row}>
              <Stepper
                label="Putt"
                unit="ft"
                min={1}
                value={Math.round(metresToFeet(shot.puttDistanceM ?? 0))}
                onChange={(v) => onChange({ ...shot, puttDistanceM: feetToMetres(v) })}
              />
              {!shot.holed ? (
                <Stepper
                  label="Remaining"
                  unit="ft"
                  min={0}
                  value={Math.round(metresToFeet(shot.puttRemainingM ?? 0))}
                  onChange={(v) => onChange({ ...shot, puttRemainingM: feetToMetres(v) })}
                />
              ) : null}
            </View>
          ) : (
            <Field label="Stance">
              <SlopeToggles value={shot.slope} onChange={(slope) => onChange({ ...shot, slope })} />
            </Field>
          )}
          <Field label="Strike">
            <ChipRow
              scroll
              options={(['good', 'fat', 'thin', 'toe', 'heel', 'top', 'shank'] as const).map(
                (v) => ({
                  value: v,
                  label: v[0]!.toUpperCase() + v.slice(1),
                }),
              )}
              value={shot.strike}
              onChange={(strike) => onChange({ ...shot, strike })}
            />
          </Field>
          <View style={styles.row}>
            <Chip
              label={shot.holed ? 'Holed ✓' : 'Mark holed'}
              selected={shot.holed}
              onPress={() => onChange({ ...shot, holed: !shot.holed })}
            />
          </View>
        </>
      ) : null}
      <Field label="Position (then tap the map)">
        <View style={styles.row}>
          <Chip label="Move start" onPress={() => onMove('start')} />
          <Chip label={penaltyRecord ? 'Move drop' : 'Move end'} onPress={() => onMove('end')} />
        </View>
      </Field>
      <View style={styles.row}>
        <Chip label="Insert before" onPress={() => onInsert('before')} />
        <Chip label="Insert after" onPress={() => onInsert('after')} />
      </View>
      <View style={styles.actions}>
        <Button
          variant="danger"
          label="Delete"
          onPress={() =>
            Alert.alert('Delete shot?', 'The chain and score are recomputed.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: onDelete },
            ])
          }
        />
        <View style={{ flex: 1 }} />
        <Button label="Done" onPress={onClose} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.sm },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  title: { ...type.heading, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
  warn: { ...type.caption, color: colors.warning },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  actions: { flexDirection: 'row', alignItems: 'center' },
});
