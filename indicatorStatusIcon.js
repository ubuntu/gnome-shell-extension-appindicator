// This file is part of the AppIndicator/KStatusNotifierItem GNOME Shell extension
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU General Public License
// as published by the Free Software Foundation; either version 2
// of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program; if not, write to the Free Software
// Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

/* exported IndicatorStatusIcon */

const Clutter = imports.gi.Clutter;
const GObject = imports.gi.GObject;
const St = imports.gi.St;

const Main = imports.ui.main;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();

const AppIndicator = Extension.imports.appIndicator;
const DBusMenu = Extension.imports.dbusMenu;
const Util = Extension.imports.util;

/*
 * IndicatorStatusIcon implements an icon in the system status area
 */
var IndicatorStatusIcon = GObject.registerClass(
class AppIndicatorsIndicatorStatusIcon extends PanelMenu.Button {
    _init(indicator) {
        super._init(0.5, indicator.uniqueId);
        this._indicator = indicator;

        this._iconBox = new AppIndicator.IconActor(indicator, Panel.PANEL_ICON_SIZE);
        this._box = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
        this._box.add_style_class_name('appindicator-box');
        this.add_child(this._box);

        this._box.add_child(this._iconBox);

        Util.connectSmart(this._indicator, 'ready', this, this._display);
        Util.connectSmart(this._indicator, 'menu', this, this._updateMenu);
        Util.connectSmart(this._indicator, 'label', this, this._updateLabel);
        Util.connectSmart(this._indicator, 'status', this, this._updateStatus);
        Util.connectSmart(this._indicator, 'reset', this, () => {
            this._updateStatus();
            this._updateLabel();
        });

        this.connect('destroy', () => {
            if (this._menuClient) {
                this._menuClient.destroy();
                this._menuClient = null;
            }
        });

        if (this._indicator.isReady)
            this._display();
    }

    _updateLabel() {
        var label = this._indicator.label;
        if (label) {
            if (!this._label || !this._labelBin) {
                this._labelBin = new St.Bin({
                    y_align: Util.versionCheck(['3.34'])
                        ? St.Align.MIDDLE : Clutter.ActorAlign.CENTER,
                });
                this._label = new St.Label();
                this._labelBin.add_actor(this._label);
                this._box.add_actor(this._labelBin);
            }
            this._label.set_text(label);
            if (!this._box.contains(this._labelBin))
                this._box.add_actor(this._labelBin); // FIXME: why is it suddenly necessary?
        } else if (this._label) {
            this._labelBin.destroy_all_children();
            this._box.remove_actor(this._labelBin);
            this._labelBin.destroy();
            delete this._labelBin;
            delete this._label;
        }
    }

    _updateStatus() {
        this.visible = this._indicator.status !== AppIndicator.SNIStatus.PASSIVE;
    }

    _updateMenu() {
        if (this._menuClient) {
            this._menuClient.destroy();
            this._menuClient = null;
            this.menu.removeAll();
        }

        if (this._indicator.menuPath) {
            this._menuClient = new DBusMenu.Client(this._indicator.busName,
                this._indicator.menuPath);
            this._menuClient.attachToMenu(this.menu);
        }
    }

    _display() {
        this._updateLabel();
        this._updateStatus();
        this._updateMenu();

        Main.panel.addToStatusArea(`appindicator-${this._indicator.uniqueId}`, this, 1, 'right');
    }

    vfunc_button_press_event(buttonEvent) {
        // if middle mouse button clicked send SecondaryActivate dbus event and do not show appindicator menu
        if (buttonEvent.button === 2) {
            Main.panel.menuManager._closeMenu(true, Main.panel.menuManager.activeMenu);
            this._indicator.secondaryActivate();
            return Clutter.EVENT_STOP;
        }

        if (buttonEvent.button === 1 && buttonEvent.click_count === 2) {
            this._indicator.open();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_scroll_event(scrollEvent) {
        // Since Clutter 1.10, clutter will always send a smooth scrolling event
        // with explicit deltas, no matter what input device is used
        // In fact, for every scroll there will be a smooth and non-smooth scroll
        // event, and we can choose which one we interpret.
        if (scrollEvent.direction === Clutter.ScrollDirection.SMOOTH) {
            const event = Clutter.get_current_event();
            let [dx, dy] = event.get_scroll_delta();

            this._indicator.scroll(dx, dy);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }
});
