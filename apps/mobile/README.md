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
