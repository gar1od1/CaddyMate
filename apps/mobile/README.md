# CaddyMate mobile (Expo)

```sh
cp .env.example .env            # fill in the Supabase anon key
pnpm install                    # from the repo root
npx expo prebuild --platform android   # or: eas build --profile development
npx expo run:android            # dev build on a connected phone
npx expo start --dev-client
```

MapLibre and expo-location have native code, so Expo Go will not work; use a
development build. `npx expo export --platform android` bundles without a device
and is what CI can run to validate Metro resolution.

## Tests

`pnpm test` (vitest) covers the pure modules in `src/features` and `src/lib`; components and
screens are exercised by the Maestro smoke flow below.

## Maestro smoke test

`.maestro/log-a-hole.yaml` (repo root) is the SPEC §16 "log a hole" smoke test: sign in → Start
round → Tee off → hole 1 → **Hit** → **Ball here** → **Holed** → the scorecard shows **2** strokes
on hole 1. `.maestro/sign-in.yaml` is the sign-in sub-flow it runs. Elements are driven by
`testID` (`home-start-round`, `new-round-tee-off`, `play-hit`, `play-ball-here`, `play-holed`,
`play-hole-done`, `play-scorecard`, `scorecard-strokes-<n>`, `sign-in-*`); keep them when you
touch those screens.

What it needs:

1. **A build without the dev launcher** on an emulator/device: `eas build --profile preview
--platform android` (or `npx expo run:android --variant release`) with `EXPO_PUBLIC_SUPABASE_*`
   pointing at the backend below, installed as `ie.caddymate.app`.
2. **A backend with a published course** whose hole 1 you know the coordinates of (the round is
   started on the first course/tee set listed).
3. **A test user with a known one-time code.** Email OTP codes are random, so either:
   - run against the local stack (`supabase start`): request a code for the test email once, read
     it from the local mail catcher (Inbucket/Mailpit, `http://127.0.0.1:54324` by default) and
     pass it in while it is still valid; or
   - configure a fixed test OTP for the test email if your Supabase CLI version supports it for
     email (check `supabase --help` / the CLI's `config.toml` reference; it was not verifiable here
     and `supabase/config.toml` is unchanged).

   Pass the email and code as `MAESTRO_TEST_EMAIL` / `MAESTRO_TEST_CODE`.

4. **GPS positions** (Maestro `setLocation`): `TEE_LAT`/`TEE_LNG` on hole 1's tee and
   `BALL_LAT`/`BALL_LNG` somewhere on hole 1 that is **off the green** (on the green the play view
   switches to the putt card, which has no Holed button) and outside penalty areas.

```sh
maestro test .maestro/log-a-hole.yaml \
  -e MAESTRO_TEST_EMAIL=smoke@example.com -e MAESTRO_TEST_CODE=123456 \
  -e TEE_LAT=53.4245 -e TEE_LNG=-6.9165 -e BALL_LAT=53.4260 -e BALL_LNG=-6.9165
```

If the emulator's fix is worse than ±8 m the app asks to wait; the flow taps "Use anyway". The
flow is not run in CI (it needs an emulator, a build and a backend).
