import type { FeatureKind } from '@/lib/courses/types';

/** What a finished drawing is written to. */
export type DrawTarget =
  | { t: 'line'; holeId: string }
  | { t: 'green'; holeId: string }
  | { t: 'greenCentre'; holeId: string }
  | { t: 'tee'; holeId: string; teeSetId: string }
  | { t: 'newFeature'; holeId: string; kind: FeatureKind }
  | { t: 'feature'; featureId: string }
  | { t: 'courseCentre' };

export type StartDraw = (target: DrawTarget, opts?: { fresh?: boolean }) => void;

export const PROMPTS: Record<DrawTarget['t'], string> = {
  line: 'Click from the tee through the landing zones to the green centre; click the last point again to finish.',
  green: 'Click around the green; click the first point to close it.',
  greenCentre: 'Click the centre of the green.',
  tee: 'Click the tee marker position.',
  newFeature: 'Draw the feature; click the first point to close it (trees: one click).',
  feature: 'Click the new position.',
  courseCentre: 'Click the course centre.',
};

/** Shown while an existing polygon or line is open for editing. */
export const EDIT_PROMPT =
  'Drag vertices to reshape; drag a midpoint to add one; select a vertex and press Delete to remove it.';
