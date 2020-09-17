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
const Clutter = imports.gi.Clutter;
const GObject = imports.gi.GObject;
const St = imports.gi.St;

const Main = imports.ui.main;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const Config = imports.misc.config;
const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();

const AppIndicator = Extension.imports.appIndicator
const DBusMenu = Extension.imports.dbusMenu;
const Util = Extension.imports.util;

/*
 * IndicatorStatusIcon implements an icon in the system status area
 */
var IndicatorStatusIcon = GObject.registerClass(
class AppIndicators_IndicatorStatusIcon extends PanelMenu.Button {
    _init(indicator) {
        super._init(0.5, indicator._uniqueId);
        this._indicator = indicator;

        this._iconBox = new AppIndicator.IconActor(indicator, Panel.PANEL_ICON_SIZE);
        this._box = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
        this._box.add_style_class_name('appindicator-box');
        this.add_child(this._box);

        this._box.add_child(this._iconBox);
        Util.connectSmart(this, 'button-press-event', this, '_boxClicked')

        Util.connectSmart(this._indicator, 'ready',  this, '_display')
        Util.connectSmart(this._indicator, 'menu',  this, '_updateMenu')
        Util.connectSmart(this._indicator, 'label',  this, '_updateLabel')
        Util.connectSmart(this._indicator, 'status', this, '_updateStatus')
        Util.connectSmart(this._indicator, 'reset', this, () => {
            this._updateStatus();
            this._updateLabel();
        });

        this.connect('destroy', () => {
            if (this._menuClient) {
                this._menuClient.destroy();
                this._menuClient = null;
            }
        })

        if (this._indicator.isReady)
            this._display()
    }

    _updateLabel() {
        var label = this._indicator.label;
        if (label) {
            if (!this._label || !this._labelBin) {
                this._labelBin = new St.Bin({
                    y_align: ExtensionUtils.versionCheck(['3.34'], Config.PACKAGE_VERSION) ?
                        St.Align.MIDDLE : Clutter.ActorAlign.CENTER,
                });
                this._label = new St.Label();
                this._labelBin.add_actor(this._label);
                this._box.add_actor(this._labelBin);
            }
            this._label.set_text(label);
            if (!this._box.contains(this._labelBin)) this._box.add_actor(this._labelBin); //FIXME: why is it suddenly necessary?
        } else {
            if (this._label) {
                this._labelBin.destroy_all_children();
                this._box.remove_actor(this._labelBin);
                this._labelBin.destroy();
                delete this._labelBin;
                delete this._label;
            }
        }
    }

    _updateStatus() {
        this.visible = this._indicator.status != AppIndicator.SNIStatus.PASSIVE;
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

        Main.panel.addToStatusArea("appindicator-"+this._indicator.uniqueId, this, 1, 'right')
    }

    _boxClicked(actor, event) {
        // if middle mouse button clicked send SecondaryActivate dbus event and do not show appindicator menu
        if (event.get_button() == 2) {
            Main.panel.menuManager._closeMenu(true, Main.panel.menuManager.activeMenu);
            this._indicator.secondaryActivate();
            return;
        }

        //HACK: event should be a ClutterButtonEvent but we get only a ClutterEvent (why?)
        //      because we can't access click_count, we'll create our own double click detector.
        var treshold = Clutter.Settings.get_default().double_click_time;
        var now = new Date().getTime();
        if (this._lastClicked && (now - this._lastClicked) < treshold) {
            this._lastClicked = null; //reset double click detector
            this._indicator.open();
        } else {
            this._lastClicked = now;
        }
    }
});
