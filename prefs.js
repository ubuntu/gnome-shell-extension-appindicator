// -*- mode: js2; indent-tabs-mode: nil; js2-basic-offset: 4 -*-

/* exported init, buildPrefsWidget */

const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Gettext = imports.gettext.domain(Me.metadata['gettext-domain']);
const _ = Gettext.gettext;

function init() {
    ExtensionUtils.initTranslations();
}

const AppIndicatorPreferences = GObject.registerClass(
class AppIndicatorPreferences extends Gtk.Grid {
    _init() {
        super._init({ row_spacing: 10 });
        this.margin = 24;
        this._settings = ExtensionUtils.getSettings();

        let label = null;
        let widget = null;

        // Icon opacity
        label = new Gtk.Label({
            label: _('Opacity (min: 0, max: 255)'),
            hexpand: true,
            halign: Gtk.Align.START,
        });
        widget = new Gtk.SpinButton({ halign: Gtk.Align.END });
        widget.set_sensitive(true);
        widget.set_range(0, 255);
        widget.set_value(this._settings.get_int('icon-opacity'));
        widget.set_increments(1, 2);
        widget.connect('value-changed', w => {
            this._settings.set_int('icon-opacity', w.get_value_as_int());
        });
        this.attach(label, 0, 1, 1, 1);
        this.attach(widget, 1, 1, 1, 1);

        // Icon saturation
        label = new Gtk.Label({
            label: _('Desaturation (min: 0.0, max: 1.0)'),
            hexpand: true,
            halign: Gtk.Align.START,
        });
        widget = new Gtk.SpinButton({ halign: Gtk.Align.END, digits: 1 });
        widget.set_sensitive(true);
        widget.set_range(0.0, 1.0);
        widget.set_value(this._settings.get_double('icon-saturation'));
        widget.set_increments(0.1, 0.2);
        widget.connect('value-changed', w => {
            this._settings.set_double('icon-saturation', w.get_value());
        });
        this.attach(label, 0, 2, 1, 1);
        this.attach(widget, 1, 2, 1, 1);

        // Icon brightness
        label = new Gtk.Label({
            label: _('Brightness (min: -1.0, max: 1.0)'),
            hexpand: true,
            halign: Gtk.Align.START,
        });
        widget = new Gtk.SpinButton({ halign: Gtk.Align.END, digits: 1 });
        widget.set_sensitive(true);
        widget.set_range(-1.0, 1.0);
        widget.set_value(this._settings.get_double('icon-brightness'));
        widget.set_increments(0.1, 0.2);
        widget.connect('value-changed', w => {
            this._settings.set_double('icon-brightness', w.get_value());
        });
        this.attach(label, 0, 3, 1, 1);
        this.attach(widget, 1, 3, 1, 1);

        // Icon contrast
        label = new Gtk.Label({
            label: _('Contrast (min: -1.0, max: 1.0)'),
            hexpand: true,
            halign: Gtk.Align.START,
        });
        widget = new Gtk.SpinButton({ halign: Gtk.Align.END, digits: 1 });
        widget.set_sensitive(true);
        widget.set_range(-1.0, 1.0);
        widget.set_value(this._settings.get_double('icon-contrast'));
        widget.set_increments(0.1, 0.2);
        widget.connect('value-changed', w => {
            this._settings.set_double('icon-contrast', w.get_value());
        });
        this.attach(label, 0, 4, 1, 1);
        this.attach(widget, 1, 4, 1, 1);

        // Icon size
        label = new Gtk.Label({
            label: _('Icon size (min: 0, max: 96)'),
            hexpand: true,
            halign: Gtk.Align.START,
        });
        widget = new Gtk.SpinButton({ halign: Gtk.Align.END });
        widget.set_sensitive(true);
        widget.set_range(0, 96);
        widget.set_value(this._settings.get_int('icon-size'));
        widget.set_increments(1, 2);
        widget.connect('value-changed', w => {
            this._settings.set_int('icon-size', w.get_value_as_int());
        });
        this.attach(label, 0, 5, 1, 1);
        this.attach(widget, 1, 5, 1, 1);

        // Tray position in panel
        label = new Gtk.Label({
            label: _('Tray horizontal alignment'),
            hexpand: true,
            halign: Gtk.Align.START,
        });
        widget = new Gtk.ComboBoxText();
        widget.append('center', _('Center'));
        widget.append('left', _('Left'));
        widget.append('right', _('Right'));
        this._settings.bind('tray-pos', widget, 'active-id', Gio.SettingsBindFlags.DEFAULT);
        this.attach(label, 0, 7, 1, 1);
        this.attach(widget, 1, 7, 1, 1);
    }

    set margin(value) {
        this.set({
            margin_start: value,
            margin_end: value,
            margin_top: value,
            margin_bottom: value,
        });
    }
});

function buildPrefsWidget() {
    let widget = new AppIndicatorPreferences();

    if (widget.show_all)
        widget.show_all();

    return widget;
}
