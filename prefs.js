// -*- mode: js2; indent-tabs-mode: nil; js2-basic-offset: 4 -*-

/* exported init, buildPrefsWidget */

import Gtk from 'gi://Gtk';  // will be removed
import Gdk from 'gi://Gdk';
import * as GeneralPreferences from './preferences/generalPage.js';
import * as CustomIconPreferences from './preferences/customIconPage.js';

import {
    ExtensionPreferences,
    gettext as _
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SettingsKey = {
    LEGACY_TRAY_ENABLED: 'legacy-tray-enabled',
    ICON_SIZE: 'icon-size',
    ICON_OPACITY: 'icon-opacity',
    ICON_SATURATION: 'icon-saturation',
    ICON_BRIGHTNESS: 'icon-brightness',
    ICON_CONTRAST: 'icon-contrast',
    TRAY_POS: 'tray-pos',
    CUSTOM_ICONS: 'custom-icons',
};

export default class DockPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const iconTheme = Gtk.IconTheme.get_for_display(Gdk.Display.get_default());
        if (!iconTheme.get_search_path().includes(`${this.path}/icons`))
            iconTheme.add_search_path(`${this.path}/icons`);


        const settings = this.getSettings();
        const generalPage = new GeneralPreferences.GeneralPage(settings, SettingsKey);
        const customIconPage = new CustomIconPreferences.CustomIconPage(settings, SettingsKey);

        window.add(generalPage);
        window.add(customIconPage);

        window.connect('close-request', () => {
            window.destroy();
        });
    }
}
