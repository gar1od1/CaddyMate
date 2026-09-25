# CaddyMate watch app (Garmin Connect IQ)

Companion **watch-app** for the Garmin **Vivoactive 5** (SPEC §11, Phase D).
Monkey C, built with the Garmin Connect IQ SDK, not pnpm. The phone stays the
source of truth: the watch shows what the phone sends and reports button presses
with its own GPS fix. Protocol rationale: `docs/decisions/001-watch-protocol.md`.

> **Not compiled yet.** This code was written without the Connect IQ SDK
> (unavailable in the authoring environment). Expect a first build to surface a
> few type-checker complaints; see "Known unknowns" below.

## Layout

```
manifest.xml                 app id, watch-app, vivoactive5, minApiLevel 5.0.0,
                             permissions Communications + Positioning
monkey.jungle                build config
resources/
  strings/strings.xml        all UI text
  layouts/layouts.xml        "waiting for phone" screen
  menus/menus.xml            action menu (Hit, Ball here, Holed, Club)
  drawables/drawables.xml    launcher icon
  drawables/launcher_icon.svg / .png   icon source + 70x70 PNG used by the build
source/
  CaddyMateApp.mc            AppBase: phone-message + GPS listeners, initial view
  PlayModel.mc               view model filled from the phone's `state`
  PlayView.mc                hole, F/C/B, landing, club + aim, cone glyph, footer
  PlayDelegate.mc            buttons/touch, action menu, club picker (Menu2)
  Bridge.mc                  encode/decode, persistent outbox, retry/replay
```

## Controls (Vivoactive 5)

| Input                    | Action                                                   |
| ------------------------ | -------------------------------------------------------- |
| Top-right button or tap  | Action menu: **Hit**, **Ball here**, **Holed**, **Club** |
| Hold bottom-right (menu) | Club picker directly                                     |
| Bottom-right (back)      | Exit (buffered marks are kept and replayed next launch)  |

Every recorded action gives a short vibration. The footer shows the last action,
`N queued` while messages wait for the phone, and a GPS dot (green good/usable,
orange poor/last-known, red none).

## Prerequisites

1. Connect IQ SDK Manager from <https://developer.garmin.com/connect-iq/sdk/>;
   install SDK **7.x or newer** (the code uses tuple return types) and the
   **vivoactive5** device.
2. Java 11+ on `PATH` (the SDK tools are Java).
3. A developer key (once):

   ```sh
   openssl genrsa -out developer_key.pem 4096
   openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem -out developer_key -nocrypt
   ```

   Keep it out of git (`.gitignore` covers it). The same key must sign every
   build you sideload, or the watch treats it as a different app and drops its storage.

4. `bin/` of the SDK on `PATH` (`monkeyc`, `connectiq`, `monkeydo`).

## Build

From `apps/watch/`:

```sh
monkeyc -d vivoactive5 -f monkey.jungle -o bin/CaddyMate.prg -y developer_key
```

Useful flags: `-w` (show warnings), `-l 3` (strict type checking; default is
gradual), `-l 0` to switch type checking off if a first build is blocked by a
type-only error you want to look at later.

Launcher icon: `resources/drawables/launcher_icon.png` (70x70 RGBA) is checked
in. To regenerate it from the SVG: `rsvg-convert -w 70 -h 70 resources/drawables/launcher_icon.svg -o resources/drawables/launcher_icon.png`
(or Inkscape: `inkscape launcher_icon.svg -w 70 -h 70 -o launcher_icon.png`). If
the compiler warns about the size, it rescales to the device's launcher size.

## Simulator

```sh
connectiq &                                   # start the simulator
monkeydo bin/CaddyMate.prg vivoactive5        # load the app
```

- GPS: simulator menu **Simulation > Activity Data** (or Data Fields > Position)
  and start playback of a GPX/FIT track, or set a fixed position.
- Phone messages: **Settings > Connection Type > Tethered/Bluetooth** plus the
  phone app in TETHERED mode (Android: `adb forward tcp:7381 tcp:7381`, then the
  app's `ConnectIQ.getInstance(ctx, IQConnectType.TETHERED)`). Without a phone
  side you can still exercise the UI: sends fail, the footer shows `N queued`,
  and they replay once the connection works.
- Queue persistence: **File > Edit Persistent Storage** shows `outbox`,
  `nextId`, `lastState`.

## Sideload to the watch

1. Connect the Vivoactive 5 by USB (it mounts as a drive; on macOS use
   Android File Transfer / OpenMTP since it is MTP).
2. Copy `bin/CaddyMate.prg` into `GARMIN/APPS/` on the watch.
3. Eject; the watch installs it on disconnect. It appears in the apps list as
   **CaddyMate**.

Updating = copy the new `.prg` over the old one (same developer key). To remove:
delete the file from `GARMIN/APPS/`. Store distribution later needs an `.iq`
package (`monkeyc -e ...`) and Connect IQ Store review.

## Message protocol (v1)

Transport: Connect IQ app messages (`Communications.transmit` /
`registerForPhoneAppMessages` on the watch; Connect IQ Mobile SDK on the phone,
addressed to app id `3c6bad9f67c047e495ca820294050770`). Payloads are
dictionaries with string keys. The TypeScript source of truth is
`apps/mobile/src/lib/garmin/protocol.ts`; keep this table, that file and
`source/Bridge.mc` in sync.

Conventions: every message has `v` (protocol version, currently `1`) and `type`.
`ts` = Unix **seconds** (integer). Coordinates are **integer 1e-7 degrees**
(Monkey C `Float` is 32-bit). Unknown/absent values are **omitted**, never
`null`. Receivers ignore unknown fields; the watch ignores unknown types.

### Phone -> watch

| `type`  | Fields                                                                                                    | When                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `state` | `hole` int; `par` int?; `stroke` int? (next stroke number); `unit` `"yd"`\|`"m"`                          | On every change of what the watch shows, and in reply to every `hello`. |
|         | `distances` `{front?, centre?, back?, landing?}` ints in `unit` (landing = recommended landing point)     | Always the full state; the watch keeps no history.                      |
|         | `recommendation?` `{clubId?, club, aimText}`: e.g. `{club:"7i", aimText:"9 yds L"}`                       |                                                                         |
|         | `cone?` `{aimDeg, halfDeg}`: real degrees vs the pin line, `+` = right; the watch draws it exaggerated x3 |                                                                         |
|         | `clubs` `[{id, name}]` in bag order (club picker); `selectedClubId?`                                      |                                                                         |

### Watch -> phone

| `type`  | Fields                                                                                    | Meaning / phone action                                                                                                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hello` | `ts`, `appVersion`, `pending` (messages still queued)                                     | Watch app opened. Reply with `state`. Not queued/persisted, no `id`.                                                                                                                                          |
| `mark`  | `id`, `hole`, `ts`, `kind` `"hit"`\|`"ball"`, `quality` 0-4, `latE7?`, `lngE7?`, `fixTs?` | **Hit** (§5.3: `start_position`) or **Ball here** (§5.4: `end_position`). `quality` = `Position.Quality` (0 none, 1 last-known, 2 poor, 3 usable, 4 good). No coordinates => use the phone's own fix at `ts`. |
| `holed` | `id`, `hole`, `ts`                                                                        | **Holed** (§5.4): end the hole, `end_position` = pin.                                                                                                                                                         |
| `club`  | `id`, `hole`, `ts`, `clubId`                                                              | Club picked on the watch: set it on the pre-shot card, then resend `state`.                                                                                                                                   |

Delivery semantics (watch -> phone): at-least-once, in order. `mark`, `holed`
and `club` are appended to a persistent outbox and removed only when
`transmit` reports `onComplete`. Retries back off 5 s -> 60 s, and any message
from the phone triggers an immediate replay. The phone must dedupe on
`(type, id, ts)` and must use `hole` + `ts` from the message (not "now") so a
replayed mark lands on the right shot. `id` increments per install.

## Known unknowns (verify on first build / on the watch)

- `minApiLevel="5.0.0"`: believed to be the Vivoactive 5's API level; check the
  SDK's `devices/vivoactive5/compiler.json` and lower it if the build refuses.
- Type-checker strictness around `Dictionary` access, `Graphics.Point2D`
  casts and `Application.PropertyValueType` casts in `Bridge.mc` / `PlayView.mc`.
- `menus.xml` Menu2 resource syntax (`<menu2>` / `<menu-item>`); if rejected,
  build the action menu in code like the club picker in `PlayDelegate.mc`.
- Tap -> `onSelect` mapping on the Vivoactive 5 touchscreen, and which physical
  press triggers `onMenu` (expected: hold the bottom button).
- Layout fractions in `PlayView.mc` were chosen for 390x390 without a render check.
- Storage value size limit for the outbox (cap `OUTBOX_MAX = 150`).
- `transmit` behaviour when the phone app is not running (expected: `onError`,
  which leaves the message queued).
