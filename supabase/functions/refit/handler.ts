/**
 * `POST /refit { clubIds?: string[], recomputeNeutral?: boolean, learnConditions?: boolean }`
 * — the authoritative pattern refit (docs/SPEC.md §8.8). Defaults to all the
 * caller's clubs. `learnConditions` (default true) first learns the player's
 * condition coefficients (§8.6, decision 007). See ../_shared/refit.ts.
 */
import { HttpError, json } from '../_shared/http.ts';
import { type Grants, requirePermission } from '../_shared/permissions.ts';
import { refitClubs, type JobStore } from '../_shared/refit.ts';
import { isUuid, readJson } from '../_shared/store.ts';

export const MAX_CLUBS = 100;

export interface RefitDeps {
  /** Verify the caller and load their grants; throws HttpError(401) otherwise. */
  authenticate(req: Request): Promise<{ userId: string; store: JobStore; grants: Grants }>;
  now(): Date;
}

export function parseClubIds(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > MAX_CLUBS || !raw.every(isUuid)) {
    throw new HttpError(400, 'bad_request', `clubIds must be an array of ≤ ${MAX_CLUBS} uuids`);
  }
  return [...new Set(raw)];
}

export async function handleRefit(req: Request, deps: RefitDeps): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST');
  const { userId, store, grants } = await deps.authenticate(req);
  requirePermission(grants, 'clubs.refit');
  const body = await readJson(req);
  const clubIds = parseClubIds(body.clubIds);
  for (const flag of ['recomputeNeutral', 'learnConditions'] as const) {
    if (body[flag] !== undefined && typeof body[flag] !== 'boolean') {
      throw new HttpError(400, 'bad_request', `${flag} must be a boolean`);
    }
  }
  const result = await refitClubs(store, userId, {
    ...(clubIds ? { clubIds } : {}),
    recomputeNeutral: body.recomputeNeutral === true,
    learnConditions: body.learnConditions !== false,
    now: deps.now(),
  });
  return json(result);
}
