// Input for the play screen (SPEC §11 watch actions).
//
// Vivoactive 5: top-right button or a tap  -> action menu (Hit, Ball here,
//                                              Holed, Club)
//               hold bottom-right (menu)   -> club picker directly
//               bottom-right (back)        -> exit (the outbox is persisted)

import Toybox.Lang;
import Toybox.WatchUi;

class PlayDelegate extends WatchUi.BehaviorDelegate {
    private var _model as PlayModel;
    private var _bridge as Bridge;

    function initialize(model as PlayModel, bridge as Bridge) {
        BehaviorDelegate.initialize();
        _model = model;
        _bridge = bridge;
    }

    function onSelect() as Boolean {
        WatchUi.pushView(new Rez.Menus.ActionMenu(), new ActionMenuDelegate(_model, _bridge), WatchUi.SLIDE_UP);
        return true;
    }

    function onMenu() as Boolean {
        WatchUi.pushView(buildClubMenu(_model), new ClubMenuDelegate(_model, _bridge), WatchUi.SLIDE_UP);
        return true;
    }
}

class ActionMenuDelegate extends WatchUi.Menu2InputDelegate {
    private var _model as PlayModel;
    private var _bridge as Bridge;

    function initialize(model as PlayModel, bridge as Bridge) {
        Menu2InputDelegate.initialize();
        _model = model;
        _bridge = bridge;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :club) {
            // Replace the action menu with the club picker.
            WatchUi.switchToView(buildClubMenu(_model), new ClubMenuDelegate(_model, _bridge), WatchUi.SLIDE_LEFT);
            return;
        }
        if (id == :hit) {
            _model.status = WatchUi.loadResource(Rez.Strings.Hit) as String;
            _bridge.sendMark("hit");
        } else if (id == :ball) {
            _model.status = WatchUi.loadResource(Rez.Strings.BallHere) as String;
            _bridge.sendMark("ball");
        } else if (id == :holed) {
            _model.status = WatchUi.loadResource(Rez.Strings.Holed) as String;
            _bridge.sendHoled();
        }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        WatchUi.requestUpdate();
    }
}

// Club picker populated from the `clubs` list in the phone's last state.
function buildClubMenu(model as PlayModel) as WatchUi.Menu2 {
    var menu = new WatchUi.Menu2({ :title => WatchUi.loadResource(Rez.Strings.ClubsTitle) as String });
    var clubs = model.clubs;
    if (clubs.size() == 0) {
        menu.addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.NoClubs) as String, null, :none, null));
        return menu;
    }
    var focus = 0;
    for (var i = 0; i < clubs.size(); i += 1) {
        var id = clubs[i].get("id") as String;
        var name = clubs[i].get("name") as String;
        var sub = null;
        if (model.recClubId != null && id.equals(model.recClubId)) {
            sub = "recommended";
        }
        if (model.selectedClubId != null && id.equals(model.selectedClubId)) {
            sub = sub == null ? "selected" : "selected, recommended";
            focus = i;
        }
        menu.addItem(new WatchUi.MenuItem(name, sub, id, null));
    }
    menu.setFocus(focus);
    return menu;
}

class ClubMenuDelegate extends WatchUi.Menu2InputDelegate {
    private var _model as PlayModel;
    private var _bridge as Bridge;

    function initialize(model as PlayModel, bridge as Bridge) {
        Menu2InputDelegate.initialize();
        _model = model;
        _bridge = bridge;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id instanceof String) {
            _model.status = item.getLabel();
            _bridge.sendClub(id);
        }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        WatchUi.requestUpdate();
    }
}
