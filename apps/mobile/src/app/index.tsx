import type { Round } from '@caddymate/api';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Section';
import { useLocalRounds, useRemoteRoundsMerge, useSyncStatus } from '@/data/hooks';
import { homeTiles } from '@/features/home/tiles';
import { useHoleScoresSummary } from '@/features/scorecard/useScorecard';
import { useAuth } from '@/lib/auth';
import { useGrants } from '@/lib/grants';
import { shortDate } from '@/lib/format';
import { supabase } from '@/lib/supabase';

function RoundRow({ round, canReview }: { round: Round; canReview: boolean }) {
  const summary = useHoleScoresSummary(round.id);
  const live = round.status === 'live';
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
      onPress={() =>
        router.push({
          pathname: live ? '/round/[id]' : '/round/[id]/summary',
          params: { id: round.id },
        })
      }
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{shortDate(round.startedAt)}</Text>
        <Text style={styles.rowSub}>
          {live ? 'In progress' : round.status === 'complete' ? 'Complete' : 'Abandoned'} ·{' '}
          {summary.holesPlayed} holes
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.rowScore}>{summary.gross || '–'}</Text>
        <Text style={styles.rowSub}>{summary.points} pts</Text>
      </View>
      {round.status === 'complete' && canReview ? (
        <Pressable
          hitSlop={8}
          testID={`home-review-${round.id}`}
          style={({ pressed }) => [styles.review, pressed && { opacity: 0.7 }]}
          onPress={() =>
            router.push({ pathname: '/review/[roundId]', params: { roundId: round.id } })
          }
        >
          <Text style={styles.reviewText}>Review</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

export default function Home() {
  const { session } = useAuth();
  useRemoteRoundsMerge(!!session);
  const rounds = useLocalRounds();
  const sync = useSyncStatus();
  const live = rounds.data?.find((r) => r.status === 'live');
  // Gate 2: a tile shows only when its route's page is held (permissions.md §5).
  const tiles = homeTiles(useGrants());

  return (
    <View style={styles.screen}>
      {tiles.play ? (
        <View style={styles.hero}>
          {live ? (
            <Button
              big
              label="Resume round"
              testID="home-resume-round"
              onPress={() => router.push({ pathname: '/round/[id]', params: { id: live.id } })}
            />
          ) : null}
          <Button
            big
            variant={live ? 'secondary' : 'primary'}
            label="Start round"
            testID="home-start-round"
            onPress={() => router.push('/round/new')}
          />
        </View>
      ) : null}
      <View style={styles.actions}>
        {tiles.bag ? (
          <Button
            variant="secondary"
            label="My bag"
            testID="home-bag"
            onPress={() => router.push('/bag')}
          />
        ) : null}
        {tiles.trends ? (
          <Button
            variant="secondary"
            label="Trends"
            testID="home-trends"
            onPress={() => router.push('/review/trends')}
          />
        ) : null}
        <View style={{ flex: 1 }} />
        <Button
          variant="ghost"
          label="Sign out"
          testID="home-sign-out"
          onPress={() => void supabase.auth.signOut()}
        />
      </View>
      <View style={styles.listHeader}>
        <Label>Recent rounds</Label>
        <Text style={styles.sync}>
          {sync.data?.pending ? `${String(sync.data.pending)} to sync` : 'Synced'}
        </Text>
      </View>
      <FlatList
        data={rounds.data ?? []}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <RoundRow round={item} canReview={tiles.review} />}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {rounds.loading ? 'Loading…' : 'No rounds yet. Set up your bag, then start a round.'}
          </Text>
        }
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
      />
      <Text style={styles.footer}>{session?.user.email ?? ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, gap: spacing.md },
  hero: { flexDirection: 'row', gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  sync: { ...type.caption, color: colors.textFaint },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  rowTitle: { ...type.heading, color: colors.text },
  rowSub: { ...type.caption, color: colors.textMuted },
  rowScore: { fontSize: 28, fontWeight: '800', color: colors.text },
  review: {
    marginLeft: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  reviewText: { ...type.caption, color: colors.accentText, fontWeight: '800' },
  empty: { ...type.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  footer: { ...type.caption, color: colors.textFaint, textAlign: 'center' },
});
