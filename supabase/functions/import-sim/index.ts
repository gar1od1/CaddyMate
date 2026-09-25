// Supabase Edge Function `import-sim` — see ./handler.ts and ../README.md.
import { requireUser, serviceClient } from '../_shared/auth.ts';
import { serveJson } from '../_shared/http.ts';
import { supabaseSimStore } from '../_shared/store.ts';
import { handleImportSim } from './handler.ts';

Deno.serve(
  serveJson((req) =>
    handleImportSim(req, {
      async authenticate(r) {
        const { user, client } = await requireUser(r);
        return { userId: user.id, store: supabaseSimStore(client, serviceClient(), user.id) };
      },
      now: () => new Date(),
    }),
  ),
);
