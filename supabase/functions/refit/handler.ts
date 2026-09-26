/**
 * `POST /refit { clubIds?: string[], recomputeNeutral?: boolean }` — the
 * authoritative pattern refit (docs/SPEC.md §8.8). Defaults to all the
 * caller's clubs. See ../_shared/refit.ts.
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
  if (body.recomputeNeutral !== undefined && typeof body.recomputeNeutral !== 'boolean') {
    throw new HttpError(400, 'bad_request', 'recomputeNeutral must be a boolean');
  }
  const result = await refitClubs(store, userId, {
    ...(clubIds ? { clubIds } : {}),
    recomputeNeutral: body.recomputeNeutral === true,
    now: deps.now(),
  });
  return json(result);
}
