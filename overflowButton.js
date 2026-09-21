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

import * as DBusMenu from './dbusMenu.js';
import * as OverflowManagerModule from './overflowManager.js';
import * as SettingsManager from './settingsManager.js';
import * as WindowManager from './windowManager.js';

const FALLBACK_ICON_NAME = 'application-x-executable-symbolic';

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

        this._applyStyle();
    }

    vfunc_event(event) {
        if (event.type() === Clutter.EventType.TOUCH_BEGIN ||
            event.type() === Clutter.EventType.BUTTON_PRESS) {
            this.menu?.toggle();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _applyStyle() {
        const settings = SettingsManager.getDefaultGSettings();
        if (settings.get_boolean('compact-mode-enabled'))
            this.set_style('-natural-hpadding: 10px');
        else
            this.set_style(null);
    }

    updateMenu(overflowedIcons) {
        this._destroyMenuClients();
        this.menu.removeAll();

        for (const statusIcon of overflowedIcons) {
            const indicator = statusIcon._indicator;
            if (!indicator)
                continue;

            const appId = indicator.appId;
            const label = indicator.title || appId || 'Unknown';

            // Use PopupSubMenuMenuItem: left click = activate window,
            // right click / expand arrow = show app menu + "Show on Panel"
            const subMenu =
                new PopupMenu.PopupSubMenuMenuItem(label);

            // Use gicon from the actual tray icon for proper rendering
            const gicon = statusIcon._icon?.gicon;
            const menuIcon = gicon
                ? new St.Icon({gicon, style_class: 'popup-menu-icon'})
                : new St.Icon({
                    icon_name: FALLBACK_ICON_NAME,
                    style_class: 'popup-menu-icon',
                });
            subMenu.insert_child_below(
                menuIcon, subMenu.label);

            // Left click on the row = activate/toggle window + close overflow
            subMenu.connect('button-press-event', (_actor, event) => {
                if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                    if (!WindowManager.toggleWindows(indicator))
                        indicator.open(
                            ...event.get_coords(), event.get_time());
                    this.menu.close();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });

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
