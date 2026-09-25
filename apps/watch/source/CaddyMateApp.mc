// CaddyMate Connect IQ watch app entry point (SPEC §11).
//
// The watch is a thin remote for the phone: it displays the `state` the phone
// pushes and sends position marks / hole events back. It never computes
// strategy. See apps/watch/README.md for the message protocol.

import Toybox.Application;
import Toybox.Communications;
import Toybox.Lang;
import Toybox.Position;
import Toybox.WatchUi;

class CaddyMateApp extends Application.AppBase {
    var model as PlayModel;
    var bridge as Bridge;

    function initialize() {
        AppBase.initialize();
        model = new PlayModel();
        bridge = new Bridge(model);
    }

    function onStart(state as Dictionary?) as Void {
        // Phone -> watch messages from the CaddyMate phone app (Connect IQ Mobile SDK).
        Communications.registerForPhoneAppMessages(method(:onPhoneMessage));
        // 1 Hz fixes while the app is open, so a mark always has a warm GPS.
        Position.enableLocationEvents(Position.LOCATION_CONTINUOUS, method(:onPosition));
        // Say hello (asks the phone for fresh state) and replay any buffered marks.
        bridge.start();
    }

    function onStop(state as Dictionary?) as Void {
        Position.enableLocationEvents(Position.LOCATION_DISABLE, method(:onPosition));
        bridge.stop();
    }

    function onPhoneMessage(msg as Communications.PhoneAppMessage) as Void {
        bridge.handleInbound(msg.data);
    }

    function onPosition(info as Position.Info) as Void {
        model.lastFix = info;
        WatchUi.requestUpdate();
    }

    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return [new PlayView(model), new PlayDelegate(model, bridge)];
    }
}
