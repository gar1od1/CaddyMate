/**
 * Phone-side bridge to the CaddyMate Connect IQ watch app (SPEC §11).
 *
 * App code depends only on the `WatchBridge` interface. Until the native
 * Connect IQ module exists, `createWatchBridge()` returns a `NoopWatchBridge`
 * and the round flow works phone-only, exactly as in Phases 1–C.
 */
import {
  CONNECT_IQ_APP_ID,
  createInboundDeduper,
  decodeWatchMessage,
  encodeStateMessage,
  type WatchClubSelected,
  type WatchHello,
  type WatchHoled,
  type WatchInbound,
  type WatchMark,
  type WatchState,
  type WirePhoneToWatch,
} from './protocol';

export type Unsubscribe = () => void;

export interface WatchBridge {
  /** False when no native module / no paired watch: callers may skip work. */
  readonly isAvailable: boolean;
  /**
   * Push the full display state. Call on every change (hole, ball position,
   * recommendation, bag) and in reply to every `onHello`. Fire-and-forget:
   * a watch app that is not open simply misses it and asks again via hello.
   */
  sendState(state: WatchState): Promise<void>;
  /** Hit / Ball here from the wrist; already deduplicated. */
  onMark(handler: (mark: WatchMark) => void): Unsubscribe;
  /** Holed from the wrist; already deduplicated. */
  onHoled(handler: (event: WatchHoled) => void): Unsubscribe;
  /** Club picked on the watch; already deduplicated. */
  onClubSelected(handler: (event: WatchClubSelected) => void): Unsubscribe;
  /** Watch app opened: reply with `sendState`. */
  onHello(handler: (hello: WatchHello) => void): Unsubscribe;
}

type Handlers = {
  [K in WatchInbound['type']]: Set<(value: Extract<WatchInbound, { type: K }>['value']) => void>;
};

/**
 * Shared listener plumbing. Implementations call `receive(raw)` with whatever
 * the transport delivered; decoding, validation and dedupe happen here.
 */
export abstract class BaseWatchBridge implements WatchBridge {
  abstract readonly isAvailable: boolean;
  abstract sendState(state: WatchState): Promise<void>;

  private readonly handlers: Handlers = {
    hello: new Set(),
    mark: new Set(),
    holed: new Set(),
    club: new Set(),
  };
  private readonly deduper = createInboundDeduper();

  onMark(handler: (mark: WatchMark) => void): Unsubscribe {
    return this.add(this.handlers.mark, handler);
  }
  onHoled(handler: (event: WatchHoled) => void): Unsubscribe {
    return this.add(this.handlers.holed, handler);
  }
  onClubSelected(handler: (event: WatchClubSelected) => void): Unsubscribe {
    return this.add(this.handlers.club, handler);
  }
  onHello(handler: (hello: WatchHello) => void): Unsubscribe {
    return this.add(this.handlers.hello, handler);
  }

  /** Feed one raw payload from the transport. Returns false if it was rejected or a duplicate. */
  receive(raw: unknown): boolean {
    const decoded = decodeWatchMessage(raw);
    if (!decoded.ok) {
      console.warn(`[garmin] dropped watch message: ${decoded.error}`);
      return false;
    }
    const msg = decoded.value;
    if (this.deduper.isDuplicate(msg)) return false;
    switch (msg.type) {
      case 'hello':
        emit(this.handlers.hello, msg.value);
        break;
      case 'mark':
        emit(this.handlers.mark, msg.value);
        break;
      case 'holed':
        emit(this.handlers.holed, msg.value);
        break;
      case 'club':
        emit(this.handlers.club, msg.value);
        break;
    }
    return true;
  }

  private add<T>(set: Set<T>, handler: T): Unsubscribe {
    set.add(handler);
    return () => {
      set.delete(handler);
    };
  }
}

function emit<T>(handlers: Set<(value: T) => void>, value: T): void {
  for (const h of handlers) h(value);
}

/** Default: no watch. `sendState` is a no-op and no events ever fire. */
export class NoopWatchBridge extends BaseWatchBridge {
  readonly isAvailable = false;
  async sendState(): Promise<void> {}
}

/**
 * Contract for the native module that `ConnectIqBridge` needs. It does not
 * exist yet (Phase D work); this is its specification.
 *
 * Build it as a local Expo module (`expo-modules-core`, Kotlin + Swift) named
 * `CaddyMateConnectIQ`, wrapping the **Garmin Connect IQ Mobile SDK**:
 *
 * - Android: `com.garmin.android.connectiq.ConnectIQ`
 *   (`ConnectIQ.getInstance(context, IQConnectType.WIRELESS)`; use `TETHERED`
 *   + `adb forward tcp:7381 tcp:7381` to talk to the CIQ simulator),
 *   `initialize(...)`, `getConnectedDevices()`, `IQApp(CONNECT_IQ_APP_ID)`,
 *   `sendMessage(device, app, payload, listener)`,
 *   `registerForAppEvents(device, app, listener)`. Payloads are
 *   `java.util.Map` / `List` / boxed primitives; convert from the JS object.
 * - iOS: `ConnectIQ.framework` (`ConnectIQ.sharedInstance()`,
 *   `initialize(withUrlScheme:uiOverrideDelegate:)`, `showDeviceSelection()`,
 *   `parseDeviceSelectionResponse(from:)` in the URL handler,
 *   `sendMessage(_:to:progress:completion:)`,
 *   `register(forAppMessages:delegate:)`). Payloads are `NSDictionary`.
 *
 * Config-plugin work (`apps/mobile/plugins/with-connect-iq.js`, later):
 * - Android: add the SDK dependency (`com.garmin.connectiq:ciq-companion-app-sdk`
 *   from Maven Central, or a vendored `.aar`), and a manifest
 *   `<queries><package android:name="com.garmin.android.apps.connectmobile"/></queries>`
 *   so the SDK can see Garmin Connect on Android 11+.
 * - iOS: embed `ConnectIQ.xcframework`; add `gcm-ciq` to
 *   `LSApplicationQueriesSchemes`; register an app URL scheme (e.g.
 *   `caddymate-ciq`) that Garmin Connect calls back with the device selection;
 *   forward it from the AppDelegate / `expo-linking` to the module; persist
 *   the chosen device list. Bluetooth usage strings if the SDK version needs them.
 * - Both: a dev build (`expo-dev-client` / EAS) — Expo Go cannot load it.
 */
export interface ConnectIqNativeModule {
  /** Initialise the SDK and resolve once at least the device list is known. */
  initialize(appId: string): Promise<void>;
  /** Send to the CaddyMate watch app on every connected device. Rejects on SDK failure. */
  sendMessage(payload: WirePhoneToWatch): Promise<void>;
  /** Deliver every app message from the watch app (any device) as a plain object. */
  addMessageListener(listener: (payload: unknown) => void): { remove(): void };
}

/**
 * Real bridge over the native module above. Safe to construct without one:
 * it then behaves like `NoopWatchBridge`.
 */
export class ConnectIqBridge extends BaseWatchBridge {
  private subscription: { remove(): void } | null = null;
  private ready: Promise<void> | null = null;

  constructor(private readonly native: ConnectIqNativeModule | null) {
    super();
  }

  get isAvailable(): boolean {
    return this.native !== null;
  }

  /** Initialise the SDK and start listening. Idempotent. */
  start(): Promise<void> {
    if (!this.native) return Promise.resolve();
    if (!this.ready) {
      const native = this.native;
      this.subscription = native.addMessageListener((payload) => this.receive(payload));
      this.ready = native.initialize(CONNECT_IQ_APP_ID);
    }
    return this.ready;
  }

  stop(): void {
    this.subscription?.remove();
    this.subscription = null;
    this.ready = null;
  }

  async sendState(state: WatchState): Promise<void> {
    if (!this.native) return;
    await this.start();
    try {
      await this.native.sendMessage(encodeStateMessage(state));
    } catch (e) {
      // Watch app closed or out of range: not an error for the round. The
      // watch asks for state with `hello` when it next opens.
      console.warn('[garmin] sendState failed', e);
    }
  }
}

/**
 * Pick the bridge for this build. Pass the native module once it exists, e.g.
 * `requireOptionalNativeModule('CaddyMateConnectIQ')` from `expo-modules-core`.
 */
export function createWatchBridge(native: ConnectIqNativeModule | null = null): WatchBridge {
  return native ? new ConnectIqBridge(native) : new NoopWatchBridge();
}
