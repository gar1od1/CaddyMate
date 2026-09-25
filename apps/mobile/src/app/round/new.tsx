/** Start a round (docs/SPEC.md §5.1): course, tee set, handicap, weather snapshot. */
import {
  courseHandicap,
  listPublishedCourses,
  playingHandicap,
  uuidv4,
  type CourseSummary,
  type WeatherSnapshot,
} from '@caddymate/api';
import { colors, radius, spacing, type } from '@caddymate/ui';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Button } from '@/components/ui/Button';
import { ChipRow } from '@/components/ui/Chip';
import { Card, Field, Label } from '@/components/ui/Section';
import { Stepper } from '@/components/ui/Stepper';
import { createRound } from '@/data/actions';
import { useCourseBundle, useProfile } from '@/data/hooks';
import * as local from '@/data/local';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { weatherAt } from '@/lib/weather';

const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

export default function NewRound() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const profile = useProfile(userId || undefined);
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | undefined>();
  const [teeSetId, setTeeSetId] = useState<string | null>(null);
  const [hi, setHi] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const cached = await local.kvGet<CourseSummary[]>('courses');
      if (cached) setCourses(cached);
      try {
        const fresh = await listPublishedCourses(supabase);
        setCourses(fresh);
        await local.kvSet('courses', fresh);
      } catch (e) {
        if (!cached) setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!courseId && courses?.length) {
      const home = profile.data?.homeCourseId;
      setCourseId(courses.find((c) => c.id === home)?.id ?? courses[0]?.id);
    }
  }, [courses, courseId, profile.data?.homeCourseId]);

  useEffect(() => {
    if (hi === null && profile.data?.handicapIndexOfficial != null) {
      setHi(profile.data.handicapIndexOfficial);
    }
  }, [hi, profile.data?.handicapIndexOfficial]);

  const course = courses?.find((c) => c.id === courseId);
  const bundle = useCourseBundle(courseId, course?.currentVersion);
  const teeSets = useMemo(() => bundle.data?.teeSets ?? [], [bundle.data]);

  useEffect(() => {
    if (teeSets.length && !teeSets.some((t) => t.id === teeSetId)) {
      setTeeSetId(teeSets.find((t) => /white/i.test(t.name))?.id ?? teeSets[0]?.id ?? null);
    }
  }, [teeSets, teeSetId]);

  const tee = teeSets.find((t) => t.id === teeSetId);
  const coursePar = tee?.par ?? bundle.data?.holes.reduce((s, h) => s + h.par, 0) ?? 72;
  // TODO(wave-2): use engine scoring
  const ch =
    hi !== null && tee?.slopeRating && tee.courseRating
      ? courseHandicap(hi, tee.slopeRating, tee.courseRating, coursePar)
      : null;
  const ph = ch === null ? null : playingHandicap(ch);

  const start = async () => {
    if (!bundle.data || !tee) return;
    setBusy(true);
    try {
      const centre = bundle.data.course.centroid ?? bundle.data.holes[0]?.greenCentre ?? null;
      const weather: WeatherSnapshot | null = centre
        ? await withTimeout(
            weatherAt(centre).catch(() => null),
            4000,
          )
        : null;
      const round = await createRound({
        id: uuidv4(),
        userId,
        courseId: bundle.data.course.id,
        courseVersion: bundle.data.version,
        teeSetId: tee.id,
        weatherSnapshot: weather,
        handicapIndexUsed: hi,
        courseHandicap: ch,
        playingHandicap: ph,
      });
      router.replace({ pathname: '/round/[id]', params: { id: round.id } });
    } catch (e) {
      Alert.alert('Could not start round', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Label>Course</Label>
        {courses === null ? (
          <Text style={styles.muted}>{error ?? 'Loading courses…'}</Text>
        ) : courses.length === 0 ? (
          <Text style={styles.muted}>
            No published courses yet. Publish one from the web editor.
          </Text>
        ) : (
          courses.map((c) => (
            <Pressable
              key={c.id}
              onPress={() => setCourseId(c.id)}
              style={[styles.course, c.id === courseId && styles.courseSelected]}
            >
              <Text style={styles.courseName}>{c.name}</Text>
              <Text style={styles.muted}>{c.country}</Text>
            </Pressable>
          ))
        )}
      </Card>

      {course ? (
        <Card>
          <Field label="Tee set">
            {bundle.loading ? (
              <Text style={styles.muted}>Loading course…</Text>
            ) : teeSets.length === 0 ? (
              <Text style={styles.muted}>This course has no tee sets yet.</Text>
            ) : (
              <ChipRow
                options={teeSets.map((t) => ({
                  value: t.id,
                  label: t.name,
                  subtle:
                    t.courseRating && t.slopeRating
                      ? `${String(t.courseRating)} / ${String(t.slopeRating)}`
                      : undefined,
                }))}
                value={teeSetId}
                onChange={setTeeSetId}
              />
            )}
          </Field>
          <Field label="Handicap index">
            <Stepper
              value={hi ?? 0}
              step={0.1}
              min={-10}
              max={54}
              format={(v) => v.toFixed(1)}
              onChange={setHi}
            />
          </Field>
          <Text style={styles.muted}>
            {ch === null
              ? 'Course handicap needs the tee set rating and slope.'
              : `Course handicap ${String(ch)} · playing handicap ${String(ph)} (95 %)`}
          </Text>
        </Card>
      ) : null}

      <Button
        big
        label="Tee off"
        busy={busy}
        disabled={!tee || !bundle.data}
        onPress={() => void start()}
      />
      {bundle.error ? <Text style={styles.error}>{bundle.error.message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  muted: { ...type.caption, color: colors.textMuted },
  error: { ...type.caption, color: colors.danger },
  course: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  courseSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceMuted },
  courseName: { ...type.heading, color: colors.text },
});
