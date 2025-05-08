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
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Panel from 'resource:///org/gnome/shell/ui/panel.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import * as AppIndicator from './appIndicator.js';
import * as PromiseUtils from './promiseUtils.js';
import * as SettingsManager from './settingsManager.js';
import * as Util from './util.js';
import * as DBusMenu from './dbusMenu.js';

const DEFAULT_ICON_SIZE = Panel.PANEL_ICON_SIZE || 16;

export function addIconToPanel(statusIcon) {
    if (!(statusIcon instanceof BaseStatusIcon))
        throw TypeError(`Unexpected icon type: ${statusIcon}`);

    const settings = SettingsManager.getDefaultGSettings();
    const indicatorId = `appindicator-${statusIcon.uniqueId}`;

    const currentIcon = Main.panel.statusArea[indicatorId];
    if (currentIcon) {
        if (currentIcon !== statusIcon)
            currentIcon.destroy();

        Main.panel.statusArea[indicatorId] = null;
    }

    Main.panel.addToStatusArea(indicatorId, statusIcon, 1,
        settings.get_string('tray-pos'));

    Util.connectSmart(settings, 'changed::tray-pos', statusIcon, () =>
        addIconToPanel(statusIcon));
}

export function getTrayIcons() {
    return Object.values(Main.panel.statusArea).filter(
        i => i instanceof IndicatorStatusTrayIcon);
}

export function getAppIndicatorIcons() {
    return Object.values(Main.panel.statusArea).filter(
        i => i instanceof IndicatorStatusIcon);
}

export const BaseStatusIcon = GObject.registerClass(
class IndicatorBaseStatusIcon extends PanelMenu.Button {
    _init(menuAlignment, nameText, iconActor, dontCreateMenu) {
        super._init(menuAlignment, nameText, dontCreateMenu);

        const settings = SettingsManager.getDefaultGSettings();
        Util.connectSmart(settings, 'changed::icon-opacity', this, this._updateOpacity);
        this.connect('notify::hover', () => this._onHoverChanged());

        if (!super._onDestroy)
            this.connect('destroy', () => this._onDestroy());

        this._box = new St.BoxLayout({style_class: 'panel-status-indicators-box'});
        this.add_child(this._box);

        this._setIconActor(iconActor);
        this._showIfReady();
    }

    _setIconActor(icon) {
        if (!(icon instanceof Clutter.Actor))
            throw new Error(`${icon} is not a valid actor`);

        if (this._icon && this._icon !== icon)
            this._icon.destroy();

        this._icon = icon;
        this._updateEffects();
        this._monitorIconEffects();

        if (this._icon) {
            this._box.add_child(this._icon);
            const id = this._icon.connect('destroy', () => {
                this._icon.disconnect(id);
                this._icon = null;
                this._monitorIconEffects();
            });
        }
    }

    _onDestroy() {
        if (this._icon)
            this._icon.destroy();

        if (super._onDestroy)
            super._onDestroy();
    }

    isReady() {
        throw new GObject.NotImplementedError('isReady() in %s'.format(this.constructor.name));
    }

    get icon() {
        return this._icon;
    }

    get uniqueId() {
        throw new GObject.NotImplementedError('uniqueId in %s'.format(this.constructor.name));
    }

    _showIfReady() {
        this.visible = this.isReady();
    }

    _onHoverChanged() {
        if (this.hover) {
            this.opacity = 255;
            if (this._icon)
                this._icon.remove_effect_by_name('desaturate');
        } else {
            this._updateEffects();
        }
    }

    _updateOpacity() {
        const settings = SettingsManager.getDefaultGSettings();
        const userValue = settings.get_user_value('icon-opacity');
        if (userValue)
            this.opacity = userValue.unpack();
        else
            this.opacity = 255;
    }

    _updateEffects() {
        this._updateOpacity();

        if (this._icon) {
            this._updateSaturation();
            this._updateBrightnessContrast();
        }
    }

    _monitorIconEffects() {
        const settings = SettingsManager.getDefaultGSettings();
        const monitoring = !!this._iconSaturationIds;

        if (!this._icon && monitoring) {
            Util.disconnectSmart(settings, this, this._iconSaturationIds);
            delete this._iconSaturationIds;

            Util.disconnectSmart(settings, this, this._iconBrightnessIds);
            delete this._iconBrightnessIds;

            Util.disconnectSmart(settings, this, this._iconContrastIds);
            delete this._iconContrastIds;
        } else if (this._icon && !monitoring) {
            this._iconSaturationIds =
                Util.connectSmart(settings, 'changed::icon-saturation', this,
                    this._updateSaturation);
            this._iconBrightnessIds =
                Util.connectSmart(settings, 'changed::icon-brightness', this,
                    this._updateBrightnessContrast);
            this._iconContrastIds =
                Util.connectSmart(settings, 'changed::icon-contrast', this,
                    this._updateBrightnessContrast);
        }
    }

    _updateSaturation() {
        const settings = SettingsManager.getDefaultGSettings();
        const desaturationValue = settings.get_double('icon-saturation');
        let desaturateEffect = this._icon.get_effect('desaturate');

        if (desaturationValue > 0) {
            if (!desaturateEffect) {
                desaturateEffect = new Clutter.DesaturateEffect();
                this._icon.add_effect_with_name('desaturate', desaturateEffect);
            }
            desaturateEffect.set_factor(desaturationValue);
        } else if (desaturateEffect) {
            this._icon.remove_effect(desaturateEffect);
        }
    }

    _updateBrightnessContrast() {
        const settings = SettingsManager.getDefaultGSettings();
        const brightnessValue = settings.get_double('icon-brightness');
        const contrastValue = settings.get_double('icon-contrast');
        let brightnessContrastEffect = this._icon.get_effect('brightness-contrast');

        if (brightnessValue !== 0 | contrastValue !== 0) {
            if (!brightnessContrastEffect) {
                brightnessContrastEffect = new Clutter.BrightnessContrastEffect();
                this._icon.add_effect_with_name('brightness-contrast', brightnessContrastEffect);
            }
            brightnessContrastEffect.set_brightness(brightnessValue);
            brightnessContrastEffect.set_contrast(contrastValue);
        } else if (brightnessContrastEffect) {
            this._icon.remove_effect(brightnessContrastEffect);
        }
    }
});

/*
 * IndicatorStatusIcon implements an icon in the system status area
 */
export const IndicatorStatusIcon = GObject.registerClass(
class IndicatorStatusIcon extends BaseStatusIcon {
    _init(indicator) {
        super._init(0.5, indicator.accessibleName,
            new AppIndicator.IconActor(indicator, DEFAULT_ICON_SIZE));
        this._indicator = indicator;

        this._lastClickTime = -1;
        this._lastClickX = -1;
        this._lastClickY = -1;

        this._box.add_style_class_name('appindicator-box');

        Util.connectSmart(this._indicator, 'ready', this, this._showIfReady);
        Util.connectSmart(this._indicator, 'menu', this, this._updateMenu);
        Util.connectSmart(this._indicator, 'label', this, this._updateLabel);
        Util.connectSmart(this._indicator, 'status', this, this._updateStatus);
        Util.connectSmart(this._indicator, 'reset', this, () => {
            this._updateStatus();
            this._updateLabel();
        });
        Util.connectSmart(this._indicator, 'accessible-name', this, () =>
            this.set_accessible_name(this._indicator.accessibleName));
        Util.connectSmart(this._indicator, 'destroy', this, () => this.destroy());

        this.connect('notify::visible', () => this._updateMenu());

        this._showIfReady();
    }

    _onDestroy() {
        if (this._menuClient) {
            this._menuClient.disconnect(this._menuReadyId);
            this._menuClient.destroy();
            this._menuClient = null;
        }

        super._onDestroy();
    }

    get uniqueId() {
        return this._indicator.uniqueId;
    }

    isReady() {
        return this._indicator && this._indicator.isReady;
    }

    _updateLabel() {
        const {label} = this._indicator;
        if (label) {
            if (!this._label || !this._labelBin) {
                this._labelBin = new St.Bin({
                    yAlign: Clutter.ActorAlign.CENTER,
                });
                this._label = new St.Label();
                Util.addActor(this._labelBin, this._label);
                Util.addActor(this._box, this._labelBin);
            }
            this._label.set_text(label);
            if (!this._box.contains(this._labelBin))
                Util.addActor(this._box, this._labelBin); // FIXME: why is it suddenly necessary?
        } else if (this._label) {
            this._labelBin.destroy_all_children();
            Util.removeActor(this._box, this._labelBin);
            this._labelBin.destroy();
            delete this._labelBin;
            delete this._label;
        }
    }

    _updateStatus() {
        const wasVisible = this.visible;
        this.visible = this._indicator.status !== AppIndicator.SNIStatus.PASSIVE;

        if (this.visible !== wasVisible)
            this._indicator.checkAlive().catch(logError);
    }

    _updateMenu() {
        if (this._menuClient) {
            this._menuClient.disconnect(this._menuReadyId);
            this._menuClient.destroy();
            this._menuClient = null;
            this.menu.removeAll();
        }

        if (this.visible && this._indicator.menuPath) {
            this._menuClient = new DBusMenu.Client(this._indicator.busName,
                this._indicator.menuPath, this._indicator);

            if (this._menuClient.isReady)
                this._menuClient.attachToMenu(this.menu);

            this._menuReadyId = this._menuClient.connect('ready-changed', () => {
                if (this._menuClient.isReady)
                    this._menuClient.attachToMenu(this.menu);
                else
                    this._updateMenu();
            });
        }
    }

    _showIfReady() {
        if (!this.isReady())
            return;

        this._updateLabel();
        this._updateStatus();
        this._updateMenu();
    }

    _updateClickCount(event) {
        const [x, y] = event.get_coords();
        const time = event.get_time();
        const {doubleClickDistance, doubleClickTime} =
            Clutter.Settings.get_default();

        if (time > (this._lastClickTime + doubleClickTime) ||
            (Math.abs(x - this._lastClickX) > doubleClickDistance) ||
            (Math.abs(y - this._lastClickY) > doubleClickDistance))
            this._clickCount = 0;

        this._lastClickTime = time;
        this._lastClickX = x;
        this._lastClickY = y;

        this._clickCount = (this._clickCount % 2) + 1;

        return this._clickCount;
    }

    _maybeHandleDoubleClick(event) {
        if (this._indicator.supportsActivation === false)
            return Clutter.EVENT_PROPAGATE;

        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        if (this._updateClickCount(event) === 2) {
            this._indicator.open(...event.get_coords(), event.get_time());
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    async _waitForDoubleClick() {
        const {doubleClickTime} = Clutter.Settings.get_default();
        this._waitDoubleClickPromise = new PromiseUtils.TimeoutPromise(
            doubleClickTime);

        try {
            await this._waitDoubleClickPromise;
            this.menu.toggle();
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
        } finally {
            delete this._waitDoubleClickPromise;
        }
    }

    vfunc_event(event) {
        if (this.menu.numMenuItems && event.type() === Clutter.EventType.TOUCH_BEGIN)
            this.menu.toggle();

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_button_press_event(event) {
        if (this._waitDoubleClickPromise)
            this._waitDoubleClickPromise.cancel();

        // if middle mouse button clicked send SecondaryActivate dbus event and do not show appindicator menu
        if (event.get_button() === Clutter.BUTTON_MIDDLE) {
            if (Main.panel.menuManager.activeMenu)
                Main.panel.menuManager._closeMenu(true, Main.panel.menuManager.activeMenu);
            this._indicator.secondaryActivate(event.get_time(), ...event.get_coords());
            return Clutter.EVENT_STOP;
        }

        if (event.get_button() === Clutter.BUTTON_SECONDARY) {
            this.menu.toggle();
            return Clutter.EVENT_PROPAGATE;
        }

        const doubleClickHandled = this._maybeHandleDoubleClick(event);
        if (doubleClickHandled === Clutter.EVENT_PROPAGATE &&
            event.get_button() === Clutter.BUTTON_PRIMARY &&
            this.menu.numMenuItems) {
            if (this._indicator.supportsActivation !== false)
                this._waitForDoubleClick().catch(logError);
            else
                this.menu.toggle();
        }

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_scroll_event(event) {
        // Since Clutter 1.10, clutter will always send a smooth scrolling event
        // with explicit deltas, no matter what input device is used
        // In fact, for every scroll there will be a smooth and non-smooth scroll
        // event, and we can choose which one we interpret.
        if (event.get_scroll_direction() === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();

            this._indicator.scroll(dx, dy);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }
});

export const IndicatorStatusTrayIcon = GObject.registerClass(
class IndicatorTrayIcon extends BaseStatusIcon {
    _init(icon) {
        super._init(0.5, icon.wm_class, icon, {dontCreateMenu: true});
        Util.Logger.debug(`Adding legacy tray icon ${this.uniqueId}`);
        this._box.add_style_class_name('appindicator-trayicons-box');
        this.add_style_class_name('appindicator-icon');
        this.add_style_class_name('tray-icon');

        this.connect('button-press-event', (_actor, _event) => {
            this.add_style_pseudo_class('active');
            return Clutter.EVENT_PROPAGATE;
        });
        this.connect('button-release-event', (_actor, event) => {
            this._icon.click(event);
            this.remove_style_pseudo_class('active');
            return Clutter.EVENT_PROPAGATE;
        });
        this.connect('key-press-event', (_actor, event) => {
            this.add_style_pseudo_class('active');
            this._icon.click(event);
            return Clutter.EVENT_PROPAGATE;
        });
        this.connect('key-release-event', (_actor, event) => {
            this._icon.click(event);
            this.remove_style_pseudo_class('active');
            return Clutter.EVENT_PROPAGATE;
        });

        Util.connectSmart(this._icon, 'destroy', this, () => {
            icon.clear_effects();
            this.destroy();
        });

        const settings = SettingsManager.getDefaultGSettings();
        Util.connectSmart(settings, 'changed::icon-size', this, this._updateIconSize);

        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        Util.connectSmart(themeContext, 'notify::scale-factor', this, () =>
            this._updateIconSize());

        this._updateIconSize();
    }

    _onDestroy() {
        Util.Logger.debug(`Destroying legacy tray icon ${this.uniqueId}`);

        if (this._waitDoubleClickPromise)
            this._waitDoubleClickPromise.cancel();

        super._onDestroy();
    }

    isReady() {
        return !!this._icon;
    }

    get uniqueId() {
        return `legacy:${this._icon.wm_class}:${this._icon.pid}`;
    }

    vfunc_navigate_focus(from, direction) {
        this.grab_key_focus();
        return super.vfunc_navigate_focus(from, direction);
    }

    _getSimulatedButtonEvent(touchEvent) {
        const event = Clutter.Event.new(Clutter.EventType.BUTTON_RELEASE);
        event.set_button(1);
        event.set_time(touchEvent.get_time());
        event.set_flags(touchEvent.get_flags());
        event.set_stage(global.stage);
        event.set_source(touchEvent.get_source());
        event.set_coords(...touchEvent.get_coords());
        event.set_state(touchEvent.get_state());
        return event;
    }

    vfunc_touch_event(event) {
        // Under X11 we rely on emulated pointer events
        if (!imports.gi.Meta.is_wayland_compositor())
            return Clutter.EVENT_PROPAGATE;

        const slot = event.get_event_sequence().get_slot();

        if (!this._touchPressSlot &&
            event.get_type() === Clutter.EventType.TOUCH_BEGIN) {
            this.add_style_pseudo_class('active');
            this._touchButtonEvent = this._getSimulatedButtonEvent(event);
            this._touchPressSlot = slot;
            this._touchDelayPromise = new PromiseUtils.TimeoutPromise(
                AppDisplay.MENU_POPUP_TIMEOUT);
            this._touchDelayPromise.then(() => {
                delete this._touchDelayPromise;
                delete this._touchPressSlot;
                this._touchButtonEvent.set_button(3);
                this._icon.click(this._touchButtonEvent);
                this.remove_style_pseudo_class('active');
            });
        } else if (event.get_type() === Clutter.EventType.TOUCH_END &&
                   this._touchPressSlot === slot) {
            delete this._touchPressSlot;
            delete this._touchButtonEvent;
            if (this._touchDelayPromise) {
                this._touchDelayPromise.cancel();
                delete this._touchDelayPromise;
            }

            this._icon.click(this._getSimulatedButtonEvent(event));
            this.remove_style_pseudo_class('active');
        } else if (event.get_type() === Clutter.EventType.TOUCH_UPDATE &&
                   this._touchPressSlot === slot) {
            this.add_style_pseudo_class('active');
            this._touchButtonEvent = this._getSimulatedButtonEvent(event);
        }

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_leave_event(event) {
        this.remove_style_pseudo_class('active');

        if (this._touchDelayPromise) {
            this._touchDelayPromise.cancel();
            delete this._touchDelayPromise;
        }

        return super.vfunc_leave_event(event);
    }

    _updateIconSize() {
        const settings = SettingsManager.getDefaultGSettings();
        const {scaleFactor} = St.ThemeContext.get_for_stage(global.stage);
        let iconSize = settings.get_int('icon-size');

        if (iconSize <= 0)
            iconSize = DEFAULT_ICON_SIZE;

        this.height = -1;
        this._icon.set({
            width: iconSize * scaleFactor,
            height: iconSize * scaleFactor,
            xAlign: Clutter.ActorAlign.CENTER,
            yAlign: Clutter.ActorAlign.CENTER,
        });
    }
});
