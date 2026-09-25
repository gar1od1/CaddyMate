// Phone <-> watch bridge (SPEC §11).
//
// Outbound: every event (mark / holed / club) is appended to an outbox that is
// persisted in Application.Storage *before* the first transmit attempt, then sent
// strictly in order, one message in flight at a time. A message leaves the
// outbox only when Communications reports onComplete. On onError it stays at the
// head and is retried with exponential backoff (5 s .. 60 s); any inbound phone
// message is treated as proof of reconnection and triggers an immediate replay.
// The outbox survives the app being closed, so marks taken with the phone out of
// range are replayed the next time the app is opened with the phone nearby.
//
// Delivery is at-least-once: onError can fire for a message the phone did
// receive, so every message carries a watch-unique `id` and the phone dedupes.
//
// Inbound: only `state` is handled; unknown types are ignored so the phone can
// add messages without breaking older watch builds.
//
// Wire format: Connect IQ serialises Dictionary / Array / String / Number /
// Float / Boolean / null. Coordinates are sent as integer 1e-7 degrees
// (`latE7`, `lngE7`) because Monkey C Float is 32-bit (~1 m error at 53 deg N).

import Toybox.Application;
import Toybox.Attention;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Position;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

const PROTOCOL_VERSION = 1;
const APP_VERSION = "0.1.0";

const OUTBOX_KEY = "outbox";
const NEXT_ID_KEY = "nextId";
const STATE_KEY = "lastState";
// Soft cap. Each mark is ~150 B serialised and Storage values are limited to
// ~32 KB, so 150 keeps well inside the limit (roughly a full offline round).
const OUTBOX_MAX = 150;

const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 60000;

// Adapter: Communications.transmit wants a ConnectionListener object.
class BridgeListener extends Communications.ConnectionListener {
    private var _bridge as Bridge;

    function initialize(bridge as Bridge) {
        ConnectionListener.initialize();
        _bridge = bridge;
    }

    function onComplete() as Void {
        _bridge.onTransmitComplete();
    }

    function onError() as Void {
        _bridge.onTransmitError();
    }
}

class Bridge {
    private var _model as PlayModel;
    private var _listener as BridgeListener;
    private var _outbox as Array<Dictionary>;
    private var _nextId as Number;

    private var _inFlight as Boolean;
    // What is in flight: -1 = hello, otherwise the outbox message id.
    private var _inFlightId as Number;
    // Hello is not persisted: it is only meaningful for the current app session.
    private var _helloPending as Boolean;

    private var _retryMs as Number;
    private var _timer as Timer.Timer?;

    function initialize(model as PlayModel) {
        _model = model;
        _listener = new BridgeListener(self);
        _inFlight = false;
        _inFlightId = 0;
        _helloPending = false;
        _retryMs = RETRY_MIN_MS;
        _timer = null;

        var stored = Application.Storage.getValue(OUTBOX_KEY);
        _outbox = stored instanceof Array ? stored as Array<Dictionary> : [] as Array<Dictionary>;
        var storedId = Application.Storage.getValue(NEXT_ID_KEY);
        _nextId = storedId instanceof Number ? storedId : 1;
        _model.pending = _outbox.size();

        // Show the last known hole immediately; marked stale until the phone speaks.
        var cached = Application.Storage.getValue(STATE_KEY);
        if (cached instanceof Dictionary) {
            applyState(cached, true);
        }
    }

    // ---- lifecycle -------------------------------------------------------

    function start() as Void {
        _helloPending = true;
        pump();
    }

    function stop() as Void {
        var timer = _timer;
        if (timer != null) {
            timer.stop();
        }
        persistOutbox();
    }

    // ---- outbound events ---------------------------------------------------

    // kind: "hit" or "ball". Uses the watch's own fix; position fields are null
    // when there is no fix, and the phone falls back to its own GPS.
    function sendMark(kind as String) as Void {
        var now = Time.now().value();
        var msg = {
            "type" => "mark",
            "kind" => kind,
            "hole" => _model.hole,
            "ts" => now,
            "latE7" => null,
            "lngE7" => null,
            "quality" => Position.QUALITY_NOT_AVAILABLE,
            "fixTs" => null
        } as Dictionary<String, Object?>;

        var info = Position.getInfo();
        var loc = info.position;
        if (loc != null && info.accuracy != Position.QUALITY_NOT_AVAILABLE) {
            var deg = loc.toDegrees();
            msg["latE7"] = (deg[0] * 10000000.0d).toNumber();
            msg["lngE7"] = (deg[1] * 10000000.0d).toNumber();
            msg["quality"] = info.accuracy as Number;
            var when = info.when;
            msg["fixTs"] = when != null ? when.value() : now;
        }
        enqueue(msg);
    }

    function sendHoled() as Void {
        enqueue({ "type" => "holed", "hole" => _model.hole, "ts" => Time.now().value() } as Dictionary<String, Object?>);
    }

    function sendClub(clubId as String) as Void {
        _model.selectedClubId = clubId;
        enqueue({
            "type" => "club",
            "hole" => _model.hole,
            "clubId" => clubId,
            "ts" => Time.now().value()
        } as Dictionary<String, Object?>);
    }

    private function enqueue(msg as Dictionary<String, Object?>) as Void {
        msg["v"] = PROTOCOL_VERSION;
        msg["id"] = _nextId;
        _nextId += 1;
        Application.Storage.setValue(NEXT_ID_KEY, _nextId);

        _outbox.add(msg);
        // Never drop the in-flight head; otherwise drop the oldest beyond the cap.
        while (_outbox.size() > OUTBOX_MAX && !_inFlight) {
            _outbox = _outbox.slice(1, null) as Array<Dictionary>;
        }
        persistOutbox();
        buzz();
        pump();
    }

    // ---- transmit loop ---------------------------------------------------

    private function pump() as Void {
        if (_inFlight) {
            return;
        }
        if (_helloPending) {
            _inFlightId = -1;
            transmit({
                "v" => PROTOCOL_VERSION,
                "type" => "hello",
                "ts" => Time.now().value(),
                "appVersion" => APP_VERSION,
                "pending" => _outbox.size()
            } as Dictionary<String, Object?>);
        } else if (_outbox.size() > 0) {
            var head = _outbox[0];
            var id = head.get("id");
            _inFlightId = id instanceof Number ? id : 0;
            transmit(head);
        }
    }

    private function transmit(payload as Dictionary) as Void {
        _inFlight = true;
        Communications.transmit(payload, null, _listener);
    }

    function onTransmitComplete() as Void {
        _inFlight = false;
        _retryMs = RETRY_MIN_MS;
        if (_inFlightId == -1) {
            _helloPending = false;
        } else if (_outbox.size() > 0) {
            var headId = _outbox[0].get("id");
            if (headId instanceof Number && headId == _inFlightId) {
                _outbox = _outbox.slice(1, null) as Array<Dictionary>;
                persistOutbox();
            }
        }
        pump();
        WatchUi.requestUpdate();
    }

    function onTransmitError() as Void {
        _inFlight = false;
        scheduleRetry();
        WatchUi.requestUpdate();
    }

    private function scheduleRetry() as Void {
        var timer = _timer;
        if (timer == null) {
            timer = new Timer.Timer();
            _timer = timer;
        }
        timer.stop();
        timer.start(method(:onRetryTimer), _retryMs, false);
        _retryMs = _retryMs * 2;
        if (_retryMs > RETRY_MAX_MS) {
            _retryMs = RETRY_MAX_MS;
        }
    }

    function onRetryTimer() as Void {
        pump();
    }

    private function persistOutbox() as Void {
        Application.Storage.setValue(OUTBOX_KEY, _outbox as Application.PropertyValueType);
        _model.pending = _outbox.size();
    }

    // ---- inbound -----------------------------------------------------------

    function handleInbound(data as Object?) as Void {
        if (data instanceof Dictionary) {
            var type = data.get("type");
            if (type instanceof String && type.equals("state")) {
                applyState(data, false);
                Application.Storage.setValue(STATE_KEY, data as Application.PropertyValueType);
            }
        } else {
            return;
        }
        // Any message from the phone means the link is up: replay now.
        _retryMs = RETRY_MIN_MS;
        if (!_inFlight) {
            var timer = _timer;
            if (timer != null) {
                timer.stop();
            }
            pump();
        }
        WatchUi.requestUpdate();
    }

    // Decode a `state` dictionary into the model. Tolerant: missing or
    // mistyped fields become null rather than crashing the app.
    function applyState(d as Dictionary, stale as Boolean) as Void {
        var m = _model;
        var hole = coerceNumber(d.get("hole"));
        m.hole = hole != null ? hole : 0;
        m.par = coerceNumber(d.get("par"));
        m.stroke = coerceNumber(d.get("stroke"));
        var unit = coerceString(d.get("unit"));
        m.unit = unit != null ? unit : "yd";

        m.front = null;
        m.centre = null;
        m.back = null;
        m.landing = null;
        var dist = d.get("distances");
        if (dist instanceof Dictionary) {
            m.front = coerceNumber(dist.get("front"));
            m.centre = coerceNumber(dist.get("centre"));
            m.back = coerceNumber(dist.get("back"));
            m.landing = coerceNumber(dist.get("landing"));
        }

        m.recClubId = null;
        m.recClub = null;
        m.aimText = null;
        var rec = d.get("recommendation");
        if (rec instanceof Dictionary) {
            m.recClubId = coerceString(rec.get("clubId"));
            m.recClub = coerceString(rec.get("club"));
            m.aimText = coerceString(rec.get("aimText"));
        }

        m.coneAimDeg = null;
        m.coneHalfDeg = null;
        var cone = d.get("cone");
        if (cone instanceof Dictionary) {
            m.coneAimDeg = coerceFloat(cone.get("aimDeg"));
            m.coneHalfDeg = coerceFloat(cone.get("halfDeg"));
        }

        var clubs = [] as Array<Dictionary>;
        var rawClubs = d.get("clubs");
        if (rawClubs instanceof Array) {
            for (var i = 0; i < rawClubs.size(); i += 1) {
                var c = rawClubs[i];
                if (c instanceof Dictionary) {
                    var id = coerceString(c.get("id"));
                    var name = coerceString(c.get("name"));
                    if (id != null && name != null) {
                        clubs.add({ "id" => id, "name" => name });
                    }
                }
            }
        }
        m.clubs = clubs;
        m.selectedClubId = coerceString(d.get("selectedClubId"));

        m.hasState = true;
        m.stale = stale;
    }

    // Short haptic confirmation that an action was recorded (queued).
    private function buzz() as Void {
        if (Attention has :vibrate) {
            Attention.vibrate([new Attention.VibeProfile(50, 150)]);
        }
    }
}

// ---- value coercion (the phone may send ints as Long/Float/Double) ---------

function coerceNumber(v as Object?) as Number? {
    if (v instanceof Number) {
        return v;
    }
    if (v instanceof Long) {
        return v.toNumber();
    }
    if (v instanceof Float) {
        return v.toNumber();
    }
    if (v instanceof Double) {
        return v.toNumber();
    }
    return null;
}

function coerceFloat(v as Object?) as Float? {
    if (v instanceof Float) {
        return v;
    }
    if (v instanceof Number) {
        return v.toFloat();
    }
    if (v instanceof Long) {
        return v.toFloat();
    }
    if (v instanceof Double) {
        return v.toFloat();
    }
    return null;
}

function coerceString(v as Object?) as String? {
    return v instanceof String ? v : null;
}
