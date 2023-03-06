// -*- mode: js2; indent-tabs-mode: nil; js2-basic-offset: 4 -*-

/* exported init, buildPrefsWidget */

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

try {
    // eslint-disable-next-line no-unused-expressions
    imports.misc.extensionUtils;
} catch (e) {
    const resource = Gio.Resource.load(
        '/usr/share/gnome-shell/org.gnome.Extensions.src.gresource');
    resource._register();
    imports.searchPath.push('resource:///org/gnome/Extensions/js');

    const gtkVersion = GLib.getenv('FORCE_GTK_VERSION') || '4.0';
    imports.gi.versions.Gtk = gtkVersion;
    imports.gi.versions.Gdk = gtkVersion;
}

const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Gettext = imports.gettext.domain(
    Me ? Me.metadata['gettext-domain'] : 'AppIndicatorExtension');
const _ = Gettext.gettext;

function init() {
    ExtensionUtils.initTranslations();
}

const AppIndicatorPreferences = GObject.registerClass(
class AppIndicatorPreferences extends Gtk.Box {
    _init() {
        super._init({ orientation: Gtk.Orientation.VERTICAL, spacing: 30 });
        this._settings = Me ? ExtensionUtils.getSettings()
            : new Gio.Settings({ schema_id: 'org.gnome.shell.extensions.appindicator' });

        let label = null;
        let widget = null;

        this.preferences_vbox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL,
            spacing: 8,
            margin_start: 30,
            margin_end: 30,
            margin_top: 30,
            margin_bottom: 30 });
        this.custom_icons_vbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_start: 10,
            margin_end: 10,
            margin_top: 10,
            margin_bottom: 10 });

        label = new Gtk.Label({
            label: _('Enable Legacy Tray Icons support'),
            hexpand: true,
            halign: Gtk.Align.START,
        });
        widget = new Gtk.Switch({ halign: Gtk.Align.END });

        this._settings.bind('legacy-tray-enabled', widget, 'active',
            Gio.SettingsBindFlags.DEFAULT);

        this.legacy_tray_hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_start: 10,
            margin_end: 10,
            margin_top: 10,
            margin_bottom: 10 });

        if (imports.gi.versions.Gtk === '4.0') {
            this.legacy_tray_hbox.append(label);
            this.legacy_tray_hbox.append(widget);
        } else {
            this.legacy_tray_hbox.pack_start(label, true, true, 0);
            this.legacy_tray_hbox.pack_start(widget, false, false, 0);
        }

        // Icon opacity
        this.opacity_hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_start: 10,
            margin_end: 10,
            margin_top: 10,
            margin_bottom: 10 });
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
        if (imports.gi.versions.Gtk === '4.0') {
            this.opacity_hbox.append(label);
            this.opacity_hbox.append(widget);
        } else {
            this.opacity_hbox.pack_start(label, true, true, 0);
            this.opacity_hbox.pack_start(widget, false, false, 0);
        }

        // Icon saturation
        this.saturation_hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_start: 10,
            margin_end: 10,
            margin_top: 10,
            margin_bottom: 10 });
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
        if (imports.gi.versions.Gtk === '4.0') {
            this.saturation_hbox.append(label);
            this.saturation_hbox.append(widget);
        } else {
            this.saturation_hbox.pack_start(label, true, true, 0);
            this.saturation_hbox.pack_start(widget, false, false, 0);
        }

        // Icon brightness
        this.brightness_hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_start: 10,
            margin_end: 10,
            margin_top: 10,
            margin_bottom: 10 });
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
        if (imports.gi.versions.Gtk === '4.0') {
            this.brightness_hbox.append(label);
            this.brightness_hbox.append(widget);
        } else {
            this.brightness_hbox.pack_start(label, true, true, 0);
            this.brightness_hbox.pack_start(widget, false, false, 0);
        }

        // Icon contrast
        this.contrast_hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_start: 10,
            margin_end: 10,
            margin_top: 10,
            margin_bottom: 10 });
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
        if (imports.gi.versions.Gtk === '4.0') {
            this.contrast_hbox.append(label);
            this.contrast_hbox.append(widget);
        } else {
            this.contrast_hbox.pack_start(label, true, true, 0);
            this.contrast_hbox.pack_start(widget, false, false, 0);
        }

        // Icon size
        this.icon_size_hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_start: 10,
            margin_end: 10,
            margin_top: 10,
            margin_bottom: 10 });
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
        if (imports.gi.versions.Gtk === '4.0') {
            this.icon_size_hbox.append(label);
            this.icon_size_hbox.append(widget);
        } else {
            this.icon_size_hbox.pack_start(label, true, true, 0);
            this.icon_size_hbox.pack_start(widget, false, false, 0);
        }

        // Tray position in panel
        this.tray_position_hbox = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 10,
            margin_start: 10,
            margin_end: 10,
            margin_top: 10,
            margin_bottom: 10 });
        label = new Gtk.Label({
            label: _('Tray horizontal alignment'),
            hexpand: true,
            halign: Gtk.Align.START,
        });
        widget = new Gtk.ComboBoxText();
        widget.append('center', _('Center'));
        widget.append('left', _('Left'));
        widget.append('right', _('Right'));
        this._settings.bind('tray-pos', widget, 'active-id',
            Gio.SettingsBindFlags.DEFAULT);
        if (imports.gi.versions.Gtk === '4.0') {
            this.tray_position_hbox.append(label);
            this.tray_position_hbox.append(widget);

            this.preferences_vbox.append(this.legacy_tray_hbox);
            this.preferences_vbox.append(this.opacity_hbox);
            this.preferences_vbox.append(this.saturation_hbox);
            this.preferences_vbox.append(this.brightness_hbox);
            this.preferences_vbox.append(this.contrast_hbox);
            this.preferences_vbox.append(this.icon_size_hbox);
            this.preferences_vbox.append(this.tray_position_hbox);
        } else {
            this.tray_position_hbox.pack_start(label, true, true, 0);
            this.tray_position_hbox.pack_start(widget, false, false, 0);

            this.preferences_vbox.pack_start(this.legacy_tray_hbox, true, false, 0);
            this.preferences_vbox.pack_start(this.opacity_hbox, true, false, 0);
            this.preferences_vbox.pack_start(this.saturation_hbox, true, false, 0);
            this.preferences_vbox.pack_start(this.brightness_hbox, true, false, 0);
            this.preferences_vbox.pack_start(this.contrast_hbox, true, false, 0);
            this.preferences_vbox.pack_start(this.icon_size_hbox, true, false, 0);
            this.preferences_vbox.pack_start(this.tray_position_hbox, true, false, 0);
        }

        // Custom icons section

        const customListStore = new Gtk.ListStore();
        customListStore.set_column_types([
            GObject.TYPE_STRING,
            GObject.TYPE_STRING,
            GObject.TYPE_STRING,
        ]);
        const customInitArray = this._settings.get_value('custom-icons').deep_unpack();
        customInitArray.forEach(pair => {
            customListStore.set(customListStore.append(), [0, 1, 2], pair);
        });
        customListStore.append();

        const customTreeView = new Gtk.TreeView({
            model: customListStore,
            hexpand: true,
            vexpand: true,
        });
        const customTitles = [
            _('Indicator ID'),
            _('Icon Name'),
            _('Attention Icon Name'),
        ];
        const indicatorIdColumn = new Gtk.TreeViewColumn({
            title: customTitles[0],
            sizing: Gtk.TreeViewColumnSizing.AUTOSIZE,
        });
        const customIconColumn = new Gtk.TreeViewColumn({
            title: customTitles[1],
            sizing: Gtk.TreeViewColumnSizing.AUTOSIZE,
        });
        const customAttentionIconColumn = new Gtk.TreeViewColumn({
            title: customTitles[2],
            sizing: Gtk.TreeViewColumnSizing.AUTOSIZE,
        });

        const cellrenderer = new Gtk.CellRendererText({ editable: true });

        indicatorIdColumn.pack_start(cellrenderer, true);
        customIconColumn.pack_start(cellrenderer, true);
        customAttentionIconColumn.pack_start(cellrenderer, true);
        indicatorIdColumn.add_attribute(cellrenderer, 'text', 0);
        customIconColumn.add_attribute(cellrenderer, 'text', 1);
        customAttentionIconColumn.add_attribute(cellrenderer, 'text', 2);
        customTreeView.insert_column(indicatorIdColumn, 0);
        customTreeView.insert_column(customIconColumn, 1);
        customTreeView.insert_column(customAttentionIconColumn, 2);
        customTreeView.set_grid_lines(Gtk.TreeViewGridLines.BOTH);

        if (imports.gi.versions.Gtk === '4.0')
            this.custom_icons_vbox.append(customTreeView);
        else
            this.custom_icons_vbox.pack_start(customTreeView, false, false, 0);

        cellrenderer.connect('edited', (w, path, text) => {
            this.selection = customTreeView.get_selection();
            const title = customTreeView.get_cursor()[1].get_title();
            const columnIndex = customTitles.indexOf(title);
            const selection = this.selection.get_selected();
            const iter = selection[2];
            const text2 = customListStore.get_value(iter, columnIndex ? 0 : 1);
            customListStore.set(iter, [columnIndex], [text]);
            const storeLength = customListStore.iter_n_children(null);
            const customIconArray = [];

            for (let i = 0; i < storeLength; i++) {
                const returnIter = customListStore.iter_nth_child(null, i);
                const [success, iterList] = returnIter;
                if (!success)
                    break;

                if (iterList) {
                    const id = customListStore.get_value(iterList, 0);
                    const customIcon = customListStore.get_value(iterList, 1);
                    const customAttentionIcon = customListStore.get_value(iterList, 2);
                    if (id && customIcon)
                        customIconArray.push([id, customIcon, customAttentionIcon || '']);
                } else {
                    break;
                }
            }
            this._settings.set_value('custom-icons', new GLib.Variant(
                'a(sss)', customIconArray));
            if (storeLength === 1 && (text || text2))
                customListStore.append();

            if (storeLength > 1) {
                if ((!text && !text2) && (storeLength - 1 > path))
                    customListStore.remove(iter);
                if ((text || text2) && storeLength - 1 <= path)
                    customListStore.append();
            }
        });

        this.notebook = new Gtk.Notebook();
        this.notebook.append_page(this.preferences_vbox,
            new Gtk.Label({ label: _('Preferences') }));
        this.notebook.append_page(this.custom_icons_vbox,
            new Gtk.Label({ label: _('Custom Icons') }));

        if (imports.gi.versions.Gtk === '4.0')
            this.append(this.notebook);
        else
            this.add(this.notebook);
    }
});

function buildPrefsWidget() {
    let widget = new AppIndicatorPreferences();

    if (widget.show_all)
        widget.show_all();

    return widget;
}

if (!Me) {
    GLib.setenv('GSETTINGS_SCHEMA_DIR', './schemas', true);
    Gtk.init(null);

    const loop = GLib.MainLoop.new(null, false);
    const win = new Gtk.Window();
    if (win.set_child) {
        win.set_child(buildPrefsWidget());
        win.connect('close-request', () => loop.quit());
    } else {
        win.add(buildPrefsWidget());
        win.connect('delete-event', () => loop.quit());
    }
    win.present();

    loop.run();
}
