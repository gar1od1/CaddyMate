// Supabase Edge Function `refit` — see ./handler.ts and ../README.md.
import { requireUser, serviceClient } from '../_shared/auth.ts';
import { serveJson } from '../_shared/http.ts';
import { loadGrants } from '../_shared/permissions.ts';
import { supabaseJobStore } from '../_shared/store.ts';
import { handleRefit } from './handler.ts';

Deno.serve(
  serveJson((req) =>
    handleRefit(req, {
      async authenticate(r) {
        const { user, client } = await requireUser(r);
        return {
          userId: user.id,
          store: supabaseJobStore(client, serviceClient(), user.id),
          grants: await loadGrants(client),
        };
      },
      now: () => new Date(),
    }),
  ),
);
