// View model for the play screen. Filled only from the phone's `state`
// message (Bridge.applyState) plus the watch's own GPS quality indicator.

import Toybox.Lang;
import Toybox.Position;

class PlayModel {
    // True once any state (fresh or cached from a previous session) is known.
    var hasState as Boolean;
    // True while showing cached state that the phone has not yet refreshed.
    var stale as Boolean;

    var hole as Number;
    var par as Number?;
    var stroke as Number?;
    // Display unit label for all distances, as sent by the phone ("yd" or "m").
    var unit as String;

    // Distances in `unit`, already rounded by the phone. Null = unknown.
    var front as Number?;
    var centre as Number?;
    var back as Number?;
    var landing as Number?;

    var recClubId as String?;
    var recClub as String?;
    var aimText as String?;

    // Cone glyph in real degrees: aim offset (+ = right of the pin line) and
    // half-width. The view exaggerates them for legibility.
    var coneAimDeg as Float?;
    var coneHalfDeg as Float?;

    // Bag as pushed by the phone: Array of { "id" => String, "name" => String }.
    var clubs as Array<Dictionary>;
    var selectedClubId as String?;

    // Last GPS fix from the continuous location listener.
    var lastFix as Position.Info?;

    // Transient feedback after an action ("Hit", "Ball here", ...).
    var status as String?;
    // Outbound messages not yet confirmed delivered to the phone.
    var pending as Number;

    function initialize() {
        hasState = false;
        stale = false;
        hole = 0;
        par = null;
        stroke = null;
        unit = "yd";
        front = null;
        centre = null;
        back = null;
        landing = null;
        recClubId = null;
        recClub = null;
        aimText = null;
        coneAimDeg = null;
        coneHalfDeg = null;
        clubs = [] as Array<Dictionary>;
        selectedClubId = null;
        lastFix = null;
        status = null;
        pending = 0;
    }
}
