import {
  PAGES,
  canOpenPath,
  grantsForRole,
  loadGrants,
  pageKeyForPath,
  type Grants,
} from '@caddymate/api';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { startSync } from '@/data/sync';
import { AuthProvider, useAuth } from '@/lib/auth';
import { envProblem } from '@/lib/env';
import { supabase } from '@/lib/supabase';

const PLAYER = grantsForRole('player');

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg,
        padding: spacing.xl,
      }}
    >
      {children}
    </View>
  );
}

/**
 * The signed-in user's grants (docs/standards/permissions.md §5 gate 3).
 * Starts at the player defaults so the app opens offline on the course; the
 * `my_permissions` answer replaces them when it arrives, and a failed load
 * keeps them (never more than a player, never a player locked out).
 */
function useGrants(userId: string | null): Grants {
  const [loaded, setLoaded] = useState<{ userId: string; grants: Grants } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    loadGrants(supabase).then(
      (grants) => live && setLoaded({ userId, grants }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [userId]);
  return loaded && loaded.userId === userId ? loaded.grants : PLAYER;
}

/** "Deny on the server, explain in the UI": a dismissable note after a denied route. */
function DeniedBanner({ label, onClose }: { label: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [label, onClose]);
  return (
    <Pressable
      onPress={onClose}
      accessibilityRole="alert"
      style={{
        position: 'absolute',
        left: spacing.lg,
        right: spacing.lg,
        bottom: spacing.xl,
        padding: spacing.md,
        borderRadius: radius.md,
        backgroundColor: colors.bgElevated,
        borderWidth: 1,
        borderColor: colors.warning,
      }}
    >
      <Text style={{ ...type.body, color: colors.text }}>
        {`You don't have access to ${label}. Your account's role doesn't include it.`}
      </Text>
    </Pressable>
  );
}

function Gate() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const onAuthScreen = segments[0] === 'sign-in';
  const grants = useGrants(session?.user.id ?? null);
  const [denied, setDenied] = useState<string | null>(null);
  const [deniedAt, setDeniedAt] = useState<string | null>(null);
  const closeDenied = useCallback(() => setDenied(null), []);

  // Push the local shot queue whenever someone is signed in.
  useEffect(() => (session ? startSync() : undefined), [session]);

  // Gate 3: the route's page must be held. Segments are route names
  // (`round/[id]/scorecard`); the page lookup is by prefix, so that is enough.
  const path = `/${segments.join('/')}`;
  const deniedPage =
    session && !canOpenPath(path, 'mobile', grants) ? pageKeyForPath(path, 'mobile') : null;
  // Remember what was refused across the redirect: derived state, set during
  // render once per refused path (React's "adjust state on prop change").
  if ((deniedPage ? path : null) !== deniedAt) {
    setDeniedAt(deniedPage ? path : null);
    if (deniedPage) setDenied(PAGES[deniedPage].label);
  }

  if (loading) {
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  }
  if (!session && !onAuthScreen) return <Redirect href="/sign-in" />;
  if (session && onAuthScreen) return <Redirect href="/" />;
  // Home is the fallback; if home itself is refused, explain rather than loop.
  if (deniedPage && path !== '/') return <Redirect href="/" />;

  return (
    <>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bgElevated },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'CaddyMate' }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="bag" options={{ title: 'My bag' }} />
        <Stack.Screen name="round/new" options={{ title: 'Start round' }} />
        <Stack.Screen name="round/[id]/index" options={{ headerShown: false }} />
        <Stack.Screen name="round/[id]/scorecard" options={{ title: 'Scorecard' }} />
        <Stack.Screen name="round/[id]/summary" options={{ title: 'Round summary' }} />
        <Stack.Screen name="review/[roundId]" options={{ title: 'Round review' }} />
        <Stack.Screen name="review/trends" options={{ title: 'Trends' }} />
        <Stack.Screen name="review/clubs/[clubId]" options={{ title: 'Dispersion' }} />
      </Stack>
      {denied ? <DeniedBanner label={denied} onClose={closeDenied} /> : null}
    </>
  );
}

export default function RootLayout() {
  if (envProblem) {
    return (
      <Centered>
        <Text style={{ ...type.body, color: colors.warning, textAlign: 'center' }}>
          {envProblem}
        </Text>
      </Centered>
    );
  }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <StatusBar style="light" />
        <Gate />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
