# 001 — Phone <-> watch protocol

Status: accepted (Phase D groundwork; unverified on hardware)
Scope: SPEC §5.8, §11, §15 Phase D. Code: `apps/watch/source/Bridge.mc`,
`apps/mobile/src/lib/garmin/protocol.ts` (+ `bridge.ts`). Full field table:
`apps/watch/README.md`.

## Decision

Two message directions over Connect IQ app messages, versioned with `v: 1`:

- **Phone -> watch: one message, `state`.** The complete, display-ready screen:
  hole, par, stroke, distance unit, front/centre/back/landing distances as
  integers in that unit, recommendation `{club, aimText}`, cone glyph angles,
  and the bag for the club picker. Sent on every change and in reply to `hello`.
- **Watch -> phone: events.** `hello` (app opened, please send state), `mark`
  (`kind: hit|ball` with the watch's own fix), `holed`, `club`.

## Why the watch never computes strategy

- **One source of truth.** Strategy (§9) needs the dispersion patterns, course
  geometry, elevation grid and weather, all of which live on the phone. Copying
  any of that to the watch creates a second, stale model that disagrees with
  the phone's card.
- **One engine.** `packages/engine` is TypeScript; Monkey C cannot run it.
  Re-implementing even distances in Monkey C would duplicate code that is
  100 %-tested in TS with no way to share those tests.
- **Cheap watch.** Pushing display-ready values (rounded integers, a
  pre-formatted `"9 yds L"`, unit already chosen) keeps the watch code to
  drawing and buttons, which is what we can afford to maintain without an
  automated Monkey C test suite. The one bit of presentation logic on the watch
  is exaggerating the cone angles so a 4 deg cone is visible.
- **Full state, not deltas.** A watch app that was closed, or missed a
  message, is correct after the next `state`. No sequence numbers, no merge.

Consequence: with the phone unreachable the watch shows the last state (greyed
as stale) and can still record marks, but distances do not update as you walk.
Acceptable for v1: the phone is in the pocket for the whole round.

## Watch -> phone queue semantics (§11 fallback)

- Every `mark` / `holed` / `club` gets a watch-unique integer `id` and is written
  to an **outbox in `Application.Storage` before the first send attempt**, so
  closing the app or a watch reboot loses nothing.
- **In order, one in flight.** Only the head is transmitted; it is removed only
  on `ConnectionListener.onComplete`. Order matters: `hit` must precede the
  matching `ball`, and `holed` must follow the last `ball`.
- **Retry:** on `onError` retry the head after 5 s, doubling to a 60 s cap. Any
  inbound phone message resets the backoff and replays immediately (reconnect
  signal). App start sends `hello` first, then drains the outbox.
- **At-least-once.** `onComplete` can be lost after the phone received the
  message, so duplicates are expected. The phone dedupes on `(type, id, ts)`
  (`createInboundDeduper`); `ts` guards against the id counter restarting
  after a reinstall.
- **Events carry their own context.** Each event carries the `hole` the watch
  was showing and `ts` = button press time. A mark replayed ten minutes late is
  applied to the hole and time it was taken, never to "the current shot".
- **Soft cap** of 150 queued messages (Storage value size); beyond that the
  oldest non-in-flight message is dropped. A whole round is about that size,
  and the phone is expected to be reachable within a hole or two.

## Wire-format choices

- Coordinates as integer 1e-7 degrees (`latE7`, `lngE7`): Monkey C `Float` is
  32-bit (about 1 m error at 53 deg N) and not every SDK path preserves
  `Double`. 1e-7 deg ~ 1 cm and fits a 32-bit signed int for all lat/lng.
- Timestamps as integer Unix seconds (`Time.now().value()`); the phone converts to ms.
- GPS accuracy: Connect IQ exposes a `Position.Quality` bucket (0-4), not a
  radius. The watch sends the bucket; the phone maps it to a conservative
  accuracy (good 5 m, usable 10 m, poor 25 m, last-known 50 m) for
  `start_accuracy_m` / `end_accuracy_m` and the > 8 m prompt (§16). A mark
  without a usable fix omits coordinates, and the phone uses its own fix at `ts`.
- Absent values are omitted rather than sent as `null`, because null handling
  differs between the Android and iOS Mobile SDKs' dictionary conversion.

## Deviation from the brief

The original sketch was `{type:'mark', kind, lat, lng, accuracyM, ts}`. The
domain type on the phone (`WatchMark`) has exactly that information
(`position: {lat, lng}`, `accuracyM`, `tsMs`), but the wire carries `latE7` /
`lngE7` / `quality` / `ts` in seconds for the reasons above.
