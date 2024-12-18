/* exported  GeneralPage*/

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';


export var GeneralPage = GObject.registerClass(
class AppIndicatorGeneralPage extends Adw.PreferencesPage {
    _init(settings, settingsKey) {
        super._init({
            title: _('General'),
            icon_name: 'general-preferences-symbolic',
            name: 'General Page',
        });

        this._settings = settings;
        this._settingsKey = settingsKey;

        this.group = new Adw.PreferencesGroup();  // no title since only single group

        const legacyTraySwitch = new Adw.SwitchRow({
            title: _('Enable Legacy Tray Icons support'),
            subtitle: _('Add X11 legacy tray icons to the panel area'),
            active: this._settings.get_boolean(this._settingsKey.LEGACY_TRAY_ENABLED),
        });

        legacyTraySwitch.connect('notify::active', widget =>
            this._settings.set_boolean(this._settingsKey.LEGACY_TRAY_ENABLED,
                widget.get_active()));

        this.group.add(legacyTraySwitch);

        this._createSpinRow({
            title: _('Opacity'),
            settingsKey: this._settingsKey.ICON_OPACITY,
            from: 0,
            to: 255,
            step: 1,
            round: true,
        });

        this._createSpinRow({
            title: _('Desaturation'),
            settingsKey: this._settingsKey.ICON_SATURATION,
            from: 0.0,
            to: 1.0,
            step: 0.1,
        });

        this._createSpinRow({
            title: _('Brightness'),
            settingsKey: this._settingsKey.ICON_BRIGHTNESS,
            from: -1.0,
            to: 1.0,
            step: 0.1,
        });

        this._createSpinRow({
            title: _('Contrast'),
            settingsKey: this._settingsKey.ICON_CONTRAST,
            from: -1.0,
            to: 1.0,
            step: 0.1,
        });

        this._createSpinRow({
            title: _('Icon Size'),
            settingsKey: this._settingsKey.ICON_SIZE,
            from: 0,
            to: 96,
            step: 2,
            round: true,
        });

        const alignmentList = new Gtk.StringList();
        const comboItems = [
            {pos: 'center', label: _('Center')},
            {pos: 'left', label: _('Left')},
            {pos: 'right', label: _('Right')},
        ];

        comboItems.forEach(item => alignmentList.append(item.label));

        const combo = new Adw.ComboRow({
            title: _('Tray Horizontal Alignment'),
            model: alignmentList,
        });
        const trayPos = this._settings.get_string(this._settingsKey.TRAY_POS);
        combo.set_selected(comboItems.findIndex(item => trayPos === item.pos));

        combo.connect('notify::selected', widget => this._settings.set_string(
            this._settingsKey.TRAY_POS, comboItems[widget.get_selected()].pos));

        this.group.add(combo);
        this.add(this.group);
    }

    _createSpinRow(args) {
        let title =  args.title || 'Default Title';
        let subtitle = args.subtitle || null;
        let settingsKey = args.settingsKey || '';
        let from = args.from || 0;
        let to = args.to || 100;
        let step = args.step || 1;
        let round = args.round || false;

        let spin = Adw.SpinRow.new_with_range(from, to, step);
        spin.title = title;
        if (subtitle !== null)
            spin.subtitle = subtitle;

        if (round)
            spin.set_value(this._settings.get_int(settingsKey));
        else
            spin.set_value(this._settings.get_int(settingsKey));


        spin.connect('input', widget => {
            if (round)
                this._settings.set_int(settingsKey, parseInt(widget.get_value(), 10));
            else
                this._settings.set_double(settingsKey, widget.get_value());

            return false;
        });
        spin.connect('output', widget => {
            if (round)
                this._settings.set_int(settingsKey, parseInt(widget.get_value(), 10));
            else
                this._settings.set_double(settingsKey, widget.get_value());

            return false;
        });

        this.group.add(spin);
    }
});


