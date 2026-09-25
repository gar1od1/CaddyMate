import { colors, spacing, type } from '@caddymate/ui';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { startSync } from '@/data/sync';
import { AuthProvider, useAuth } from '@/lib/auth';
import { envProblem } from '@/lib/env';

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

function Gate() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const onAuthScreen = segments[0] === 'sign-in';

  // Push the local shot queue whenever someone is signed in.
  useEffect(() => (session ? startSync() : undefined), [session]);

  if (loading) {
    return (
      <Centered>
        <ActivityIndicator color={colors.accent} />
      </Centered>
    );
  }
  if (!session && !onAuthScreen) return <Redirect href="/sign-in" />;
  if (session && onAuthScreen) return <Redirect href="/" />;

  return (
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
