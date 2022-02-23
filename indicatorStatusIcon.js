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

/* exported IndicatorStatusIcon, IndicatorStatusTrayIcon */

const Clutter = imports.gi.Clutter;
const GObject = imports.gi.GObject;
const St = imports.gi.St;

const AppDisplay = imports.ui.appDisplay;
const Main = imports.ui.main;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();

const AppIndicator = Extension.imports.appIndicator;
const DBusMenu = Extension.imports.dbusMenu;
const Util = Extension.imports.util;
const PromiseUtils = Extension.imports.promiseUtils;
const SettingsManager = Extension.imports.settingsManager;

const BaseStatusIcon = GObject.registerClass(
class AppIndicatorsIndicatorBaseStatusIcon extends PanelMenu.Button {
    _init(menuAlignment, nameText, iconActor, dontCreateMenu) {
        super._init(menuAlignment, nameText, dontCreateMenu);

        const settings = SettingsManager.getDefaultGSettings();
        Util.connectSmart(settings, 'changed::icon-opacity', this, this._updateOpacity);
        Util.connectSmart(settings, 'changed::tray-pos', this, this._showIfReady);
        this.connect('notify::hover', () => this._onHoverChanged());

        this._setIconActor(iconActor);
        this._showIfReady();
    }

    _setIconActor(icon) {
        if (!(icon instanceof Clutter.Actor))
            throw new Error(`${icon} is not a valid actor`);

        if (!this._icon) {
            const settings = SettingsManager.getDefaultGSettings();
            Util.connectSmart(settings, 'changed::icon-saturation', this, this._updateSaturation);
            Util.connectSmart(settings, 'changed::icon-brightness', this, this._updateBrightnessContrast);
            Util.connectSmart(settings, 'changed::icon-contrast', this, this._updateBrightnessContrast);
        } else if (this._icon !== icon) {
            this._icon.destroy();
        }

        this._icon = icon;
        this._updateEffects();
    }

    isReady() {
        throw new GObject.NotImplementedError('isReady() in %s'.format(this.constructor.name));
    }

    get uniqueId() {
        throw new GObject.NotImplementedError('uniqueId in %s'.format(this.constructor.name));
    }

    _showIfReady() {
        if (!this.isReady())
            return;

        const indicatorId = `appindicator-${this.uniqueId}`;
        Main.panel.statusArea[indicatorId] = null;
        Main.panel.addToStatusArea(indicatorId, this, 1,
            SettingsManager.getDefaultGSettings().get_string('tray-pos'));
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
        else if (Util.versionCheck(['40']))
            this.opacity = 255;
        else
            this.opacity = settings.get_int('icon-opacity');
    }

    _updateEffects() {
        this._updateOpacity();

        if (this._icon) {
            this._updateSaturation();
            this._updateBrightnessContrast();
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
var IndicatorStatusIcon = GObject.registerClass(
class AppIndicatorsIndicatorStatusIcon extends BaseStatusIcon {
    _init(indicator) {
        super._init(0.5, indicator.accessibleName,
            new AppIndicator.IconActor(indicator, Panel.PANEL_ICON_SIZE));
        this._indicator = indicator;

        this._box = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
        this._box.add_style_class_name('appindicator-box');
        this.add_child(this._box);

        this._box.add_child(this._icon);

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

        this.connect('destroy', () => {
            if (this._menuClient) {
                this._menuClient.destroy();
                this._menuClient = null;
            }
        });

        this._showIfReady();
    }

    get uniqueId() {
        return this._indicator.uniqueId;
    }

    isReady() {
        return this._indicator && this._indicator.isReady;
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

    _showIfReady() {
        if (!this.isReady())
            return;

        this._updateLabel();
        this._updateStatus();
        this._updateMenu();

        super._showIfReady();
    }

    vfunc_button_press_event(buttonEvent) {
        // if middle mouse button clicked send SecondaryActivate dbus event and do not show appindicator menu
        if (buttonEvent.button === 2) {
            Main.panel.menuManager._closeMenu(true, Main.panel.menuManager.activeMenu);
            this._indicator.secondaryActivate(buttonEvent.time, buttonEvent.x, buttonEvent.y);
            return Clutter.EVENT_STOP;
        }

        if (buttonEvent.button === 1 && buttonEvent.click_count === 2) {
            this._indicator.open(buttonEvent.x, buttonEvent.y);
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

var IndicatorStatusTrayIcon = GObject.registerClass(
class AppIndicatorsIndicatorTrayIcon extends BaseStatusIcon {
    _init(icon) {
        super._init(0.5, icon.wm_class, icon, { dontCreateMenu: true });
        Util.Logger.debug(`Adding legacy tray icon ${this.uniqueId}`);
        this._box = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
        this._box.add_style_class_name('appindicator-trayicons-box');
        this.add_child(this._box);

        this._box.add_child(this._icon);
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

        // eslint-disable-next-line no-undef
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        Util.connectSmart(themeContext, 'notify::scale-factor', this, () =>
            this._updateIconSize());

        this._updateIconSize();

        this.connect('destroy', () => {
            Util.Logger.debug(`Destroying legacy tray icon ${this.uniqueId}`);
            this._icon.destroy();
            this._icon = null;
        });
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
        event.set_time(touchEvent.time);
        event.set_flags(touchEvent.flags);
        event.set_stage(touchEvent.stage);
        event.set_source(touchEvent.source);
        event.set_coords(touchEvent.x, touchEvent.y);
        event.set_state(touchEvent.modifier_state);
        return event;
    }

    vfunc_touch_event(touchEvent) {
        // Under X11 we rely on emulated pointer events
        if (!imports.gi.Meta.is_wayland_compositor())
            return Clutter.EVENT_PROPAGATE;

        const slot = touchEvent.sequence.get_slot();

        if (!this._touchPressSlot &&
            touchEvent.type === Clutter.EventType.TOUCH_BEGIN) {
            this.add_style_pseudo_class('active');
            this._touchButtonEvent = this._getSimulatedButtonEvent(touchEvent);
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
        } else if (touchEvent.type === Clutter.EventType.TOUCH_END &&
                   this._touchPressSlot === slot) {
            delete this._touchPressSlot;
            delete this._touchButtonEvent;
            if (this._touchDelayPromise) {
                this._touchDelayPromise.cancel();
                delete this._touchDelayPromise;
            }

            this._icon.click(this._getSimulatedButtonEvent(touchEvent));
            this.remove_style_pseudo_class('active');
        } else if (touchEvent.type === Clutter.EventType.TOUCH_UPDATE &&
                   this._touchPressSlot === slot) {
            this.add_style_pseudo_class('active');
            this._touchButtonEvent = this._getSimulatedButtonEvent(touchEvent);
        }

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_leave_event(crossingEvent) {
        this.remove_style_pseudo_class('active');

        if (this._touchDelayPromise) {
            this._touchDelayPromise.cancel();
            delete this._touchDelayPromise;
        }

        return super.vfunc_leave_event(crossingEvent);
    }

    _updateIconSize() {
        const settings = SettingsManager.getDefaultGSettings();
        // eslint-disable-next-line no-undef
        const { scale_factor: scaleFactor } = St.ThemeContext.get_for_stage(global.stage);
        let iconSize = settings.get_int('icon-size');

        if (iconSize <= 0)
            iconSize = Panel.PANEL_ICON_SIZE;

        this.height = -1;
        this._icon.set_height(iconSize * scaleFactor);
        this._icon.set_y_align(Clutter.ActorAlign.CENTER);
    }
});
