/** The pre-shot card body (docs/SPEC.md §5.3): club, lie, slope, intended line, shape, wind. */
import type { Club, LieKind, ShapeKind } from '@caddymate/api';
import type { StanceSlope } from '@caddymate/engine';
import { colors, spacing, type } from '@caddymate/ui';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Field } from '@/components/ui/Section';
import type { PlayState } from '@/features/play/usePlay';
import { yd } from '@/lib/format';
import { SlopeToggles } from './SlopeToggles';
import { WindReadout } from './WindReadout';

export const LIES: { value: LieKind; label: string }[] = [
  { value: 'tee', label: 'Tee' },
  { value: 'fairway', label: 'Fairway' },
  { value: 'first_cut', label: '1st cut' },
  { value: 'rough', label: 'Rough' },
  { value: 'deep_rough', label: 'Deep' },
  { value: 'sand', label: 'Sand' },
  { value: 'hardpan', label: 'Hardpan' },
  { value: 'pine_straw', label: 'Straw' },
  { value: 'green', label: 'Green' },
];

const SHAPES: { value: ShapeKind; label: string }[] = [
  { value: 'straight', label: 'Straight' },
  { value: 'draw', label: 'Draw' },
  { value: 'fade', label: 'Fade' },
];

export function ClubChips({
  clubs,
  value,
  onChange,
}: {
  clubs: readonly Club[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <ChipRow
      scroll
      value={value}
      onChange={onChange}
      options={clubs
        .filter((c) => c.active)
        .map((c) => ({
          value: c.id,
          label: c.name,
          subtle: c.stockTotalM ? yd(c.stockTotalM) : undefined,
        }))}
    />
  );
}

interface Props {
  play: PlayState;
  clubs: readonly Club[];
  onOpenAimPicker: () => void;
}

export function PreShotCard({ play, clubs, onOpenAimPicker }: Props) {
  const { card, setCard } = play;
  return (
    <View style={styles.body}>
      <Field label={`Lie${card.lie === null ? ' (auto)' : ''}`}>
        <ChipRow
          scroll
          options={LIES}
          value={play.lie}
          onChange={(lie) => setCard((c) => ({ ...c, lie: lie === play.autoLie ? null : lie }))}
        />
      </Field>
      <Field label="Stance">
        <SlopeToggles value={card.slope} onChange={(slope) => setCard((c) => ({ ...c, slope }))} />
        {play.slopeSuggestion ? (
          <View style={styles.aimRow}>
            <Text style={styles.suggest}>Suggested: {slopeText(play.slopeSuggestion)}</Text>
            {sameSlope(play.slopeSuggestion, card.slope) ? (
              <Text style={styles.suggestOk}>✓</Text>
            ) : (
              <Chip label="Use" onPress={play.actions.acceptSlope} />
            )}
          </View>
        ) : null}
      </Field>
      <Field label="Intended line">
        <View style={styles.aimRow}>
          <Text style={styles.aimText}>
            {card.aim === null
              ? 'Default (line of play) — tap the map to aim'
              : card.aim.ref
                ? `${card.aim.ref.kind === 'feature' ? (card.aim.ref.featureKind ?? 'feature') : card.aim.ref.kind.replace('_', ' ')} ${offsetText(card.aim.ref.offsetRightM, card.aim.ref.offsetLongM)}`
                : 'Tapped target'}
          </Text>
          <Chip label="Feature…" onPress={onOpenAimPicker} />
          {card.aim ? (
            <Chip label="Reset" onPress={() => setCard((c) => ({ ...c, aim: null }))} />
          ) : null}
        </View>
      </Field>
      <Field label="Shape (optional)">
        <ChipRow
          options={SHAPES}
          value={card.shape}
          onChange={(shape) => setCard((c) => ({ ...c, shape: c.shape === shape ? null : shape }))}
        />
      </Field>
      <Field label="Wind">
        <WindReadout wind={play.wind} bearingDeg={play.bearing} onOverride={play.setWindOverride} />
      </Field>
      {clubs.length === 0 ? (
        <Text style={styles.warn}>No clubs yet — set up your bag from the home screen.</Text>
      ) : null}
      <Button variant="ghost" label="Putt card" onPress={() => play.setPuttMode(true)} />
    </View>
  );
}

const SLOPE_LABEL: Record<keyof StanceSlope, string> = {
  uphill: 'uphill',
  downhill: 'downhill',
  ballAboveFeet: 'ball above feet',
  ballBelowFeet: 'ball below feet',
};

function slopeText(s: StanceSlope): string {
  const parts = (Object.keys(SLOPE_LABEL) as (keyof StanceSlope)[])
    .filter((k) => s[k] !== 'none')
    .map((k) => `${SLOPE_LABEL[k]} ${s[k]}`);
  return parts.length ? parts.join(', ') : 'flat';
}

const sameSlope = (a: StanceSlope, b: StanceSlope) =>
  a.uphill === b.uphill &&
  a.downhill === b.downhill &&
  a.ballAboveFeet === b.ballAboveFeet &&
  a.ballBelowFeet === b.ballBelowFeet;

function offsetText(rightM: number, longM: number): string {
  const parts: string[] = [];
  if (Math.abs(rightM) >= 0.5)
    parts.push(`${yd(Math.abs(rightM))} ${rightM > 0 ? 'right' : 'left'}`);
  if (Math.abs(longM) >= 0.5) parts.push(`${yd(Math.abs(longM))} ${longM > 0 ? 'long' : 'short'}`);
  return parts.length ? parts.join(', ') : '(on it)';
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.sm },
  aimRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  aimText: { ...type.caption, color: colors.text, flex: 1 },
  warn: { ...type.caption, color: colors.warning },
  suggest: { ...type.caption, color: colors.textMuted, flex: 1 },
  suggestOk: { ...type.caption, color: colors.accent, fontWeight: '800' },
});
