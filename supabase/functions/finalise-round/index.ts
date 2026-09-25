// Supabase Edge Function `finalise-round` — see ./handler.ts and ../README.md.
import { requireUser, serviceClient } from '../_shared/auth.ts';
import { serveJson } from '../_shared/http.ts';
import { supabaseFinaliseStore } from '../_shared/store.ts';
import { handleFinaliseRound } from './handler.ts';

Deno.serve(
  serveJson((req) =>
    handleFinaliseRound(req, {
      async authenticate(r) {
        const { user, client } = await requireUser(r);
        return { userId: user.id, store: supabaseFinaliseStore(client, serviceClient(), user.id) };
      },
      now: () => new Date(),
    }),
  ),
);
