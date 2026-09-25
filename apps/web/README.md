# CaddyMate web (Next.js)

```sh
cp .env.example .env.local      # fill in the Supabase anon key
pnpm dev                        # http://localhost:3000
```

Session refresh lives in `src/proxy.ts` (Next 16's name for middleware).
