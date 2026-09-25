import type { LatLng } from '@caddymate/engine';
import { colors, radius, spacing, type } from '@caddymate/ui';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CourseMap } from '@/components/CourseMap';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/** Moyvalley GC clubhouse — the default view until courses load from the DB. */
const MOYVALLEY: LatLng = { lat: 53.4245, lng: -6.9165 };

export default function Home() {
  const { session } = useAuth();
  const [permission, setPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');

  useEffect(() => {
    void Location.requestForegroundPermissionsAsync().then(({ status }) => {
      setPermission(status === 'granted' ? 'granted' : 'denied');
    });
  }, []);

  return (
    <View style={styles.screen}>
      <CourseMap center={MOYVALLEY} zoom={15.5} />
      <View style={styles.sheet}>
        <Text style={styles.heading}>Moyvalley</Text>
        <Text style={styles.caption}>
          {session?.user.email ?? ''}
          {permission === 'denied' ? ' · location denied' : ''}
        </Text>
        <Pressable style={styles.signOut} onPress={() => void supabase.auth.signOut()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  sheet: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  heading: { ...type.heading, color: colors.text },
  caption: { ...type.caption, color: colors.textMuted },
  signOut: { alignSelf: 'flex-start', marginTop: spacing.sm },
  signOutText: { ...type.caption, color: colors.accent },
});
