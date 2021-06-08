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

const Main = imports.ui.main;
const Panel = imports.ui.panel;
const PanelMenu = imports.ui.panelMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Extension = ExtensionUtils.getCurrentExtension();

const AppIndicator = Extension.imports.appIndicator;
const DBusMenu = Extension.imports.dbusMenu;
const Util = Extension.imports.util;
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

        this._icon.reactive = true;
        Util.connectSmart(this._icon, 'button-release-event', this, (_actor, event) => {
            this._icon.click(event);
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
