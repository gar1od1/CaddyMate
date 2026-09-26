/**
 * Bag setup: clubs in bag order with stock distances in yards. The bag is
 * edited online (it is not on-course critical); the list is cached locally
 * for the play view.
 */
import {
  deleteClub,
  reorderClubs,
  seedDefaultBag,
  upsertClub,
  type Club,
  type ClubKind,
} from '@caddymate/api';
import { metresToYards, yardsToMetres } from '@caddymate/engine';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '@/components/ui/Button';
import { ChipRow } from '@/components/ui/Chip';
import { Card, Field } from '@/components/ui/Section';
import { Stepper } from '@/components/ui/Stepper';
import { useClubs } from '@/data/hooks';
import { canOpenClubDispersion } from '@/features/home/tiles';
import { useAuth } from '@/lib/auth';
import { useGrants } from '@/lib/grants';
import { yd } from '@/lib/format';
import { supabase } from '@/lib/supabase';

const KINDS: { value: ClubKind; label: string }[] = [
  { value: 'driver', label: 'Driver' },
  { value: 'wood', label: 'Wood' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'iron', label: 'Iron' },
  { value: 'wedge', label: 'Wedge' },
  { value: 'putter', label: 'Putter' },
];

function ClubEditor({
  club,
  onSave,
  onDelete,
  onCancel,
}: {
  club: Club;
  onSave: (c: Club) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(club);
  const [busy, setBusy] = useState(false);
  const yards = draft.stockTotalM === null ? 0 : Math.round(metresToYards(draft.stockTotalM));
  const run = (fn: () => Promise<void>) => {
    setBusy(true);
    fn()
      .catch((e: unknown) => Alert.alert('Could not save', e instanceof Error ? e.message : ''))
      .finally(() => setBusy(false));
  };
  return (
    <Card style={styles.editor}>
      <Field label="Name">
        <TextInput
          style={styles.input}
          value={draft.name}
          onChangeText={(name) => setDraft({ ...draft, name })}
          placeholder="7i"
          placeholderTextColor={colors.textFaint}
        />
      </Field>
      <Field label="Type">
        <ChipRow
          options={KINDS}
          value={draft.kind}
          onChange={(kind) => setDraft({ ...draft, kind })}
          scroll
        />
      </Field>
      <View style={styles.steppers}>
        <Stepper
          label="Stock total"
          value={yards}
          unit="yd"
          min={0}
          max={400}
          step={1}
          onChange={(v) =>
            setDraft({
              ...draft,
              stockTotalM: v > 0 ? Math.round(yardsToMetres(v) * 10) / 10 : null,
            })
          }
        />
        <Stepper
          label="Loft"
          value={draft.loftDeg ?? 0}
          unit="°"
          min={0}
          max={70}
          step={0.5}
          onChange={(v) => setDraft({ ...draft, loftDeg: v })}
        />
      </View>
      <View style={styles.switchRow}>
        <Text style={styles.body}>In the bag</Text>
        <Switch
          value={draft.active}
          onValueChange={(active) => setDraft({ ...draft, active })}
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </View>
      <View style={styles.editorActions}>
        {onDelete ? (
          <Button variant="danger" label="Delete" onPress={() => run(onDelete)} disabled={busy} />
        ) : null}
        <View style={{ flex: 1 }} />
        <Button variant="ghost" label="Cancel" onPress={onCancel} />
        <Button label="Save" busy={busy} onPress={() => run(() => onSave(draft))} />
      </View>
    </Card>
  );
}

export default function Bag() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const clubs = useClubs();
  const grants = useGrants();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = clubs.data ?? [];

  const guarded = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      clubs.reload();
    } catch (e) {
      Alert.alert('Something went wrong', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((c) => c.id);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void guarded(() => reorderClubs(supabase, ids));
  };

  const save = async (c: Club) => {
    await upsertClub(supabase, userId, c);
    setEditing(null);
    setAdding(false);
    clubs.reload();
  };

  if (!clubs.loading && list.length === 0 && !adding) {
    return (
      <View style={styles.screen}>
        <Card>
          <Text style={styles.title}>Set up your bag</Text>
          <Text style={styles.body}>
            Start from the default bag — Driver, 5W, 4H, 5i–PW, 50/54/60 and putter — with stock
            distances interpolated from Driver 240, 7i 160 and PW 120 yards. You can edit any club
            afterwards.
          </Text>
          <Button
            label="Create default bag"
            busy={busy}
            onPress={() => void guarded(() => seedDefaultBag(supabase, userId))}
          />
          <Button variant="ghost" label="Add clubs manually" onPress={() => setAdding(true)} />
          {clubs.error ? <Text style={styles.error}>{clubs.error.message}</Text> : null}
        </Card>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {adding ? (
        <ClubEditor
          club={{
            id: '',
            name: '',
            kind: 'iron',
            loftDeg: null,
            bagOrder: list.length,
            active: true,
            stockTotalM: null,
            stockCarryM: null,
            simNameAliases: [],
          }}
          onSave={(c) => save({ ...c, id: '' })}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListFooterComponent={
          adding ? null : (
            <Button
              variant="secondary"
              label="Add club"
              onPress={() => setAdding(true)}
              style={{ marginTop: spacing.lg }}
            />
          )
        }
        renderItem={({ item, index }) =>
          editing === item.id ? (
            <ClubEditor
              club={item}
              onSave={save}
              onDelete={async () => {
                await deleteClub(supabase, item.id);
                setEditing(null);
                clubs.reload();
              }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <Pressable
              style={[styles.row, !item.active && { opacity: 0.5 }]}
              onPress={() => setEditing(item.id)}
            >
              <View style={styles.order}>
                <Pressable hitSlop={6} onPress={() => move(index, -1)} disabled={busy}>
                  <Text style={styles.arrow}>▲</Text>
                </Pressable>
                <Pressable hitSlop={6} onPress={() => move(index, 1)} disabled={busy}>
                  <Text style={styles.arrow}>▼</Text>
                </Pressable>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.clubName}>{item.name}</Text>
                <Text style={styles.caption}>
                  {item.kind}
                  {item.loftDeg !== null ? ` · ${String(item.loftDeg)}°` : ''}
                </Text>
              </View>
              <Text style={styles.distance}>
                {item.kind === 'putter' ? '' : yd(item.stockTotalM)}
                {item.kind === 'putter' ? '' : <Text style={styles.caption}> yd</Text>}
              </Text>
              {/* Per-club dispersion (§14); putts have no pattern (§8). */}
              {item.kind !== 'putter' && canOpenClubDispersion(grants, item.id) ? (
                <Pressable
                  hitSlop={8}
                  testID={`bag-dispersion-${item.id}`}
                  accessibilityLabel={`${item.name} dispersion`}
                  style={({ pressed }) => [styles.link, pressed && { opacity: 0.7 }]}
                  onPress={() =>
                    router.push({ pathname: '/review/clubs/[clubId]', params: { clubId: item.id } })
                  }
                >
                  <Text style={styles.linkText}>Dispersion ›</Text>
                </Pressable>
              ) : null}
            </Pressable>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.md },
  title: { ...type.title, color: colors.text },
  body: { ...type.body, color: colors.textMuted },
  error: { ...type.caption, color: colors.danger },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  order: { gap: spacing.xs },
  arrow: { color: colors.textFaint, fontSize: 14 },
  clubName: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.textMuted },
  distance: { fontSize: 28, fontWeight: '800', color: colors.text },
  link: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  linkText: { ...type.caption, color: colors.accent, fontWeight: '800' },
  editor: { borderWidth: 1, borderColor: colors.accent },
  input: {
    backgroundColor: colors.bgElevated,
    color: colors.text,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  steppers: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  editorActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
