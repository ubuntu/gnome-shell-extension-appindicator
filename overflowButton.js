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

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as AppIndicator from './appIndicator.js';
import * as DBusMenu from './dbusMenu.js';
import * as IndicatorStatusIcon from './indicatorStatusIcon.js';
import * as OverflowManagerModule from './overflowManager.js';
import * as SettingsManager from './settingsManager.js';
import * as Util from './util.js';
import * as WindowManager from './windowManager.js';

// Whether an event happened on the expander of a submenu item. The expander
// is reactive, so it is the actor the stage delivers its events to. A button
// event carries no source to ask instead
function _isOnExpander(expander, event) {
    const actor = global.stage.get_event_actor(event);

    return !!expander && !!actor && expander.contains(actor);
}

export const OverflowButton = GObject.registerClass(
class IndicatorOverflowButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Indicator Overflow');

        // Disable ClickGesture from PanelMenu.Button to prevent
        // menu-switching when hovering over other panel elements.
        this._clickGesture?.set_enabled(false);

        this._menuClients = [];

        this._menuClients = [];

        const box = new St.BoxLayout({
            style_class: 'panel-status-indicators-box',
        });
        const icon = new St.Icon({
            icon_name: 'pan-down-symbolic',
            style_class: 'system-status-icon',
        });
        box.add_child(icon);
        this.add_child(box);

        const settings = SettingsManager.getDefaultGSettings();
        const updateStyle = () =>
            IndicatorStatusIcon.updateCompactModeStyle(this);
        Util.connectSmart(settings, 'changed::compact-mode-enabled', this, updateStyle);
        Util.connectSmart(settings, 'changed::icon-spacing', this, updateStyle);
        updateStyle();
    }

    vfunc_event(event) {
        if (event.type() === Clutter.EventType.TOUCH_BEGIN ||
            event.type() === Clutter.EventType.BUTTON_PRESS) {
            this.menu?.toggle();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    updateMenu(overflowedIcons) {
        this._destroyMenuClients();
        this.menu.removeAll();

        for (const statusIcon of overflowedIcons) {
            const indicator = statusIcon._indicator;
            if (!indicator)
                continue;

            const {appId} = indicator;
            const label = indicator.title || appId || 'Unknown';

            // Use PopupSubMenuMenuItem: left click = activate window, click
            // on the arrow, right click or keyboard = show app menu +
            // "Show on Panel"
            const subMenu = new PopupMenu.PopupSubMenuMenuItem(label, false);

            // Same icon as on the panel: a live icon actor of the indicator,
            // at the panel size, following icon changes
            const iconActor = new AppIndicator.IconActor(indicator,
                IndicatorStatusIcon.DEFAULT_ICON_SIZE);
            iconActor.reactive = false;
            subMenu.insert_child_at_index(iconActor, 0);

            // Split button look: the expander is a target of its own, set
            // off by a divider line, with the arrow centered on it
            const expander = subMenu._triangleBin;
            if (expander) {
                expander.add_style_class_name('appindicator-overflow-expander');
                expander.y_align = Clutter.ActorAlign.FILL;
                expander.reactive = true;
                expander.track_hover = true;

                // The expander of the shell fills the row, which makes the
                // half with the arrow as wide as the entry. Let the label
                // take the room instead, so the arrow keeps to its own edge
                expander.x_expand = false;
                subMenu.label.x_expand = true;

                // Without a layout manager the arrow is placed at the origin
                // of the actor, which leaves it off center inside the padding
                expander.layout_manager = new Clutter.BinLayout();
            }

            // Left click on the row = activate/toggle window + close overflow.
            // Answers whether the click was taken.
            const takeClick = event => {
                if (event?.type() !== Clutter.EventType.BUTTON_RELEASE ||
                    event.get_button() !== Clutter.BUTTON_PRIMARY)
                    return false;

                // Let the expander arrow open the app menu, as in the panel
                if (_isOnExpander(expander, event))
                    return false;

                // A tray only app has no window to raise, so the click stays
                // a plain click: let the item open the app menu, which is
                // all such an app has to offer
                const raised = WindowManager.toggleWindows(indicator,
                    event.get_time());
                if (raised)
                    this.menu.close();

                return raised;
            };

            // Every way to activate the item ends in activate(), which
            // toggles its submenu: the click action of the shell (a gesture
            // since 49) takes the release, so a handler of the row itself
            // comes too late or not at all
            const activate = subMenu.activate.bind(subMenu);
            subMenu.activate = event => {
                if (!takeClick(event))
                    activate(event);
            };

            this._attachIndicatorMenu(
                subMenu, indicator);

            this.menu.addMenuItem(subMenu);
        }

        this.visible = overflowedIcons.length > 0;
    }

    _attachIndicatorMenu(subMenu, indicator) {
        if (!indicator.menuPath) {
            // No DBus menu — just add management items
            this._addManagementItems(subMenu, indicator);
            return;
        }

        const client = new DBusMenu.Client(
            indicator.busName,
            indicator.menuPath,
            indicator
        );

        const attach = () => {
            client.attachToMenu(subMenu.menu);
            // Add "Show on Panel" AFTER DBus menu items
            // (attachToMenu calls removeAll, so we must add after)
            this._addManagementItems(subMenu, indicator);
        };

        if (client.isReady)
            attach();

        const readyId = client.connect('ready-changed', () => {
            if (client.isReady)
                attach();
        });
        this._menuClients.push({client, readyId});
    }

    _addManagementItems(subMenu, indicator) {
        const manager =
            OverflowManagerModule.OverflowManager.getDefault();
        if (!manager || !indicator.appId)
            return;

        const separator =
            new PopupMenu.PopupSeparatorMenuItem();
        subMenu.menu.addMenuItem(separator);

        const showItem = new PopupMenu.PopupMenuItem(
            'Show on Panel'
        );
        showItem.connect('activate', () => {
            manager.unhideIcon(indicator.appId);
        });
        subMenu.menu.addMenuItem(showItem);
    }

    _destroyMenuClients() {
        for (const {client, readyId} of this._menuClients) {
            client.disconnect(readyId);
            client.destroy();
        }
        this._menuClients = [];
    }

    _onDestroy() {
        this._destroyMenuClients();
        super._onDestroy();
    }
});
