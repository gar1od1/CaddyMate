// Play screen (SPEC §11): hole, front/centre/back and landing distances, the
// recommended club + aim text, and a simplified cone glyph. Drawn directly with
// Dc calls; laid out as fractions of the screen so it fits the Vivoactive 5's
// 390 x 390 round AMOLED (and degrades sensibly on other sizes).

import Toybox.Graphics;
import Toybox.Lang;
import Toybox.Math;
import Toybox.Position;
import Toybox.WatchUi;

// The phone sends the real cone angles (a few degrees); exaggerate them so the
// glyph is readable on a 1.2" screen. Presentation only, not strategy.
const CONE_EXAGGERATION = 3.0;
const CONE_MIN_HALF_DEG = 4.0;
const CONE_MAX_HALF_DEG = 40.0;

class PlayView extends WatchUi.View {
    private var _model as PlayModel;

    function initialize(model as PlayModel) {
        View.initialize();
        _model = model;
    }

    function onLayout(dc as Graphics.Dc) as Void {
        setLayout(Rez.Layouts.WaitingLayout(dc));
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var m = _model;
        if (!m.hasState) {
            // Layout: "Open a round on the phone".
            View.onUpdate(dc);
            drawFooter(dc);
            return;
        }

        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;

        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        // Header: "Hole 7  Par 4  Shot 2"
        var header = loadString(Rez.Strings.Hole) + " " + m.hole.toString();
        if (m.par != null) {
            header += "  " + loadString(Rez.Strings.Par) + " " + (m.par as Number).toString();
        }
        if (m.stroke != null) {
            header += "  #" + (m.stroke as Number).toString();
        }
        dc.setColor(m.stale ? Graphics.COLOR_LT_GRAY : Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.07, Graphics.FONT_XTINY, header, Graphics.TEXT_JUSTIFY_CENTER);

        // Centre-of-green distance, large, with front / back either side.
        var numY = h * 0.14;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, numY, Graphics.FONT_NUMBER_MEDIUM, fmt(m.centre), Graphics.TEXT_JUSTIFY_CENTER);
        var sideY = h * 0.20;
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.17, sideY, Graphics.FONT_XTINY, loadString(Rez.Strings.Front), Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w * 0.83, sideY, Graphics.FONT_XTINY, loadString(Rez.Strings.Back), Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.17, sideY + h * 0.06, Graphics.FONT_SMALL, fmt(m.front), Graphics.TEXT_JUSTIFY_CENTER);
        dc.drawText(w * 0.83, sideY + h * 0.06, Graphics.FONT_SMALL, fmt(m.back), Graphics.TEXT_JUSTIFY_CENTER);

        // Landing point distance.
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.38, Graphics.FONT_TINY,
            loadString(Rez.Strings.Landing) + " " + fmt(m.landing) + " " + m.unit,
            Graphics.TEXT_JUSTIFY_CENTER);

        // Recommendation: "7i  9 yds L"
        var rec = "";
        if (m.recClub != null) {
            rec = m.recClub as String;
        }
        if (m.aimText != null) {
            rec += (rec.length() > 0 ? "  " : "") + (m.aimText as String);
        }
        if (rec.length() > 0) {
            dc.setColor(Graphics.COLOR_YELLOW, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.47, Graphics.FONT_SMALL, rec, Graphics.TEXT_JUSTIFY_CENTER);
        }

        drawCone(dc, cx, (h * 0.84).toNumber(), (h * 0.22).toNumber());
        drawFooter(dc);
    }

    // Cone glyph: apex = the ball, straight up = the line to the pin (grey
    // tick), wedge = the conditioned dispersion cone rotated by the aim offset.
    private function drawCone(dc as Graphics.Dc, x as Number, y as Number, r as Number) as Void {
        var aim = _model.coneAimDeg;
        var half = _model.coneHalfDeg;

        // Pin line.
        dc.setPenWidth(1);
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawLine(x, y, x, y - r - 6);

        if (aim == null || half == null) {
            return;
        }
        var a = (aim as Float) * CONE_EXAGGERATION;
        var hw = (half as Float) * CONE_EXAGGERATION;
        if (hw < CONE_MIN_HALF_DEG) {
            hw = CONE_MIN_HALF_DEG;
        }
        if (hw > CONE_MAX_HALF_DEG) {
            hw = CONE_MAX_HALF_DEG;
        }
        // Dc arc angles: 0 = 3 o'clock, counter-clockwise positive. Straight up
        // is 90; aim to the right (+) therefore reduces the angle.
        var centreDeg = 90.0 - a;
        var startDeg = centreDeg - hw;
        var endDeg = centreDeg + hw;

        // Filled wedge approximated by a polygon (apex + 9 arc points).
        var pts = [[x, y] as Graphics.Point2D] as Array<Graphics.Point2D>;
        var steps = 8;
        for (var i = 0; i <= steps; i += 1) {
            var deg = startDeg + (endDeg - startDeg) * i / steps;
            var rad = Math.toRadians(deg);
            pts.add([x + r * Math.cos(rad), y - r * Math.sin(rad)] as Graphics.Point2D);
        }
        dc.setColor(0x0f3f22, Graphics.COLOR_TRANSPARENT);
        dc.fillPolygon(pts);

        // Outline: arc + the two edges.
        dc.setPenWidth(3);
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.drawArc(x, y, r, Graphics.ARC_COUNTER_CLOCKWISE, startDeg, endDeg);
        var s = Math.toRadians(startDeg);
        var e = Math.toRadians(endDeg);
        dc.drawLine(x, y, x + r * Math.cos(s), y - r * Math.sin(s));
        dc.drawLine(x, y, x + r * Math.cos(e), y - r * Math.sin(e));

        // Landing point dot on the aim line.
        var c = Math.toRadians(centreDeg);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(x + r * 0.8 * Math.cos(c), y - r * 0.8 * Math.sin(c), 4);
        dc.setPenWidth(1);
    }

    // Footer: last action + queue state, and a GPS quality dot.
    private function drawFooter(dc as Graphics.Dc) as Void {
        var m = _model;
        var w = dc.getWidth();
        var h = dc.getHeight();
        var text = "";
        if (m.status != null) {
            text = (m.status as String) + " ";
        }
        if (m.pending > 0) {
            text += m.pending.toString() + " " + loadString(Rez.Strings.Queued);
        } else if (m.status != null) {
            text += loadString(Rez.Strings.Sent);
        }
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.88, Graphics.FONT_XTINY, text, Graphics.TEXT_JUSTIFY_CENTER);

        var quality = Position.QUALITY_NOT_AVAILABLE;
        var fix = m.lastFix;
        if (fix != null) {
            quality = fix.accuracy;
        }
        var colour = Graphics.COLOR_RED;
        if (quality == Position.QUALITY_GOOD || quality == Position.QUALITY_USABLE) {
            colour = Graphics.COLOR_GREEN;
        } else if (quality == Position.QUALITY_POOR || quality == Position.QUALITY_LAST_KNOWN) {
            colour = Graphics.COLOR_ORANGE;
        }
        dc.setColor(colour, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(w / 2, (h * 0.965).toNumber(), 5);
    }

    private function fmt(n as Number?) as String {
        return n == null ? "--" : (n as Number).toString();
    }

    private function loadString(id as ResourceId) as String {
        return WatchUi.loadResource(id) as String;
    }
}
