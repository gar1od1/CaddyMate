/**
 * GPS for shot marking (docs/SPEC.md §16 "GPS quality"): best accuracy while
 * a round is live, 1 Hz updates only while the play view is focused, and an
 * accuracy gate on Hit / Ball here.
 */
import type { LatLng } from '@caddymate/engine';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

export const ACCURACY_GATE_M = 8;

export interface Fix {
  point: LatLng;
  accuracyM: number | null;
  altitudeM: number | null;
  at: number;
}

const toFix = (l: Location.LocationObject): Fix => ({
  point: { lat: l.coords.latitude, lng: l.coords.longitude },
  accuracyM: l.coords.accuracy ?? null,
  altitudeM: l.coords.altitude ?? null,
  at: l.timestamp,
});

/** Watch position at 1 Hz while the screen is focused. */
export function useLiveFix(): { fix: Fix | null; denied: boolean } {
  const [fix, setFix] = useState<Fix | null>(null);
  const [denied, setDenied] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let sub: Location.LocationSubscription | null = null;
      let cancelled = false;
      void (async () => {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== Location.PermissionStatus.GRANTED) {
          setDenied(true);
          return;
        }
        const s = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 1000,
            distanceInterval: 0,
          },
          (l) => setFix(toFix(l)),
        );
        if (cancelled) s.remove();
        else sub = s;
      })().catch(() => setDenied(true));
      return () => {
        cancelled = true;
        sub?.remove();
      };
    }, []),
  );
  return { fix, denied };
}

async function currentFix(): Promise<Fix> {
  const l = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.BestForNavigation,
  });
  return toFix(l);
}

function ask(accuracy: number): Promise<'wait' | 'accept' | 'cancel'> {
  return new Promise((resolve) => {
    Alert.alert(
      `GPS ±${String(Math.round(accuracy))} m`,
      'The position is not very accurate yet. Wait a few seconds for a better fix, or use it anyway?',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
        { text: 'Use anyway', onPress: () => resolve('accept') },
        { text: 'Wait', style: 'default', onPress: () => resolve('wait') },
      ],
      { cancelable: true, onDismiss: () => resolve('cancel') },
    );
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A fix good enough to mark a shot. Uses the live fix when it is fresh and
 * accurate; otherwise asks the OS. If accuracy is ≥ 8 m the player can wait
 * (we retry for ~5 s, keeping the best fix) or accept. Null = cancelled.
 */
export async function acquireShotFix(live: Fix | null): Promise<Fix | null> {
  const fresh = live && Date.now() - live.at < 3000 ? live : null;
  let best = fresh ?? (await currentFix().catch(() => null));
  for (;;) {
    if (!best) {
      Alert.alert('No GPS position', 'Location is unavailable. Check permissions and try again.');
      return null;
    }
    const acc = best.accuracyM;
    if (acc !== null && acc < ACCURACY_GATE_M) return best;
    const choice = await ask(acc ?? 99);
    if (choice === 'accept') return best;
    if (choice === 'cancel') return null;
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      const f = await currentFix().catch(() => null);
      if (f && (best.accuracyM === null || (f.accuracyM ?? 99) < best.accuracyM)) best = f;
      if ((best.accuracyM ?? 99) < ACCURACY_GATE_M) return best;
    }
  }
}
