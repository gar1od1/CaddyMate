# apps/mobile — notes for coding agents

The root [`CLAUDE.md`](../../CLAUDE.md) is the standing instruction set and wins wherever this file
disagrees. Read it first; this file only adds what is specific to the Expo app.

## Expo has changed — don't trust memory

Expo (SDK 57 here) ships breaking changes every release. Don't write Expo / React Native API calls
from memory: read the installed package's `.d.ts` and README under `node_modules` (docs.expo.dev
is not reachable from this environment — root `CLAUDE.md` §6). Adding a dependency: pin the
version from `node_modules/expo/bundledNativeModules.json` and `pnpm add` it (`npx expo install`
cannot reach Expo's API here).

## Navigation and routing

- **Expo Router** for all navigation. Routes live in `src/app/`: every file there is a screen,
  `_layout.tsx` files define navigators. Keep non-route code (components, hooks, data, utils)
  outside `src/app/`.
- Import `Link`, `router`, `Redirect`, `useLocalSearchParams` and `useSegments` from
  `expo-router`.
- A new route needs a page in the permission catalogue (`PAGES[...].mobile` in
  `packages/api/src/permissions.ts`); the root layout's `<Gate>` checks every route with
  `canOpenPath` (docs/standards/permissions.md §5).

## Native code

- `ios/` and `android/` are generated (Continuous Native Generation). Never create or edit them by
  hand; configure native behaviour in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code the
  app needs a development build (`npx expo run:android|ios`, or `eas build --profile
development`) — say in your report that it was not verified on a device if you could not build
  one.
- Prefer Expo modules over third-party libraries.

## Checks

The commands in root `CLAUDE.md` §7 apply, including the Android `npx expo export` (it must pass
without a `.env`, so nothing may throw at import — root `CLAUDE.md` §5).
