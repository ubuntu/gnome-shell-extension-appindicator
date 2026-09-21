/* exported IndicatorPage */

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import {
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const IndicatorData = GObject.registerClass({
    GTypeName: 'IndicatorData',
    Properties: {
        'indicator-id': GObject.ParamSpec.string(
            'indicator-id', 'Indicator ID',
            'The SNI indicator identifier',
            GObject.ParamFlags.READWRITE, ''
        ),
        'title': GObject.ParamSpec.string(
            'title', 'Title',
            'The display title of the indicator',
            GObject.ParamFlags.READWRITE, ''
        ),
        'hidden': GObject.ParamSpec.boolean(
            'hidden', 'Hidden',
            'Whether the indicator is hidden from the panel',
            GObject.ParamFlags.READWRITE, false
        ),
    },
}, class IndicatorData extends GObject.Object {
    constructor(props = {}) {
        super(props);
    }

    get indicatorId() {
        return this._indicatorId || '';
    }

    set indicatorId(value) {
        if (this._indicatorId === value)
            return;
        this._indicatorId = value;
        this.notify('indicator-id');
    }

    get title() {
        return this._title || '';
    }

    set title(value) {
        if (this._title === value)
            return;
        this._title = value;
        this.notify('title');
    }

    get hidden() {
        return this._hidden || false;
    }

    set hidden(value) {
        if (this._hidden === value)
            return;
        this._hidden = value;
        this.notify('hidden');
    }
});

export var IndicatorPage = GObject.registerClass(
class AppIndicatorIndicatorPage extends Adw.PreferencesPage {
    _init(settings, settingsKey) {
        super._init({
            title: _('Indicators'),
            icon_name: 'view-list-symbolic',
            name: 'Indicators Page',
        });

        this._settings = settings;
        this._settingsKey = settingsKey;
        this._updating = false;

        const group = new Adw.PreferencesGroup({
            title: _('Indicator Management'),
            description: _(
                'Hide indicators from the panel when Pin Mode is enabled. '
                + 'Hidden indicators go to the overflow menu.'
            ),
        });

        this._listBox = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });

        this._listStore = new Gio.ListStore({
            item_type: IndicatorData,
        });

        this._listBox.bind_model(
            this._listStore, item => this._createRow(item)
        );

        group.add(this._listBox);
        this.add(group);

        this._syncFromSettings();

        this._settingsChangedIds = [
            this._settings.connect(
                `changed::${this._settingsKey.KNOWN_INDICATORS}`,
                () => this._syncFromSettings()
            ),
            this._settings.connect(
                `changed::${this._settingsKey.HIDDEN_ICONS}`,
                () => this._syncFromSettings()
            ),
        ];

        this.connect('destroy', () => {
            for (const id of this._settingsChangedIds)
                this._settings.disconnect(id);
            this._settingsChangedIds = [];
        });
    }

    _syncFromSettings() {
        if (this._updating)
            return;

        const known = this._settings.get_value(
            this._settingsKey.KNOWN_INDICATORS
        ).deep_unpack();
        const hiddenIds = this._settings.get_strv(
            this._settingsKey.HIDDEN_ICONS
        );

        this._listStore.remove_all();

        for (const [id, title] of known) {
            this._listStore.append(new IndicatorData({
                indicatorId: id,
                title: title || id,
                hidden: hiddenIds.includes(id),
            }));
        }
    }

    _createRow(item) {
        const row = new Adw.ActionRow({
            title: GLib.markup_escape_text(item.title, -1),
            subtitle: GLib.markup_escape_text(
                item.indicatorId, -1
            ),
        });

        const hiddenSwitch = new Gtk.Switch({
            active: item.hidden,
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Hide from Panel'),
        });
        hiddenSwitch.connect('notify::active', sw => {
            this._setIconHidden(
                item.indicatorId, sw.get_active()
            );
        });

        const removeButton = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            tooltip_text: _('Remove'),
        });
        removeButton.connect('clicked', () => {
            this._removeKnownIndicator(item.indicatorId);
        });

        const hiddenBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            valign: Gtk.Align.CENTER,
        });
        hiddenBox.append(new Gtk.Label({
            label: _('Hide'),
            css_classes: ['dim-label'],
        }));
        hiddenBox.append(hiddenSwitch);

        row.add_suffix(hiddenBox);
        row.add_suffix(removeButton);

        return row;
    }

    _setIconHidden(indicatorId, hidden) {
        this._updating = true;
        const hiddenIds = this._settings.get_strv(
            this._settingsKey.HIDDEN_ICONS
        );
        if (hidden && !hiddenIds.includes(indicatorId)) {
            hiddenIds.push(indicatorId);
            this._settings.set_strv(
                this._settingsKey.HIDDEN_ICONS, hiddenIds
            );
        } else if (!hidden) {
            const filtered =
                hiddenIds.filter(id => id !== indicatorId);
            if (filtered.length !== hiddenIds.length) {
                this._settings.set_strv(
                    this._settingsKey.HIDDEN_ICONS, filtered
                );
            }
        }
        this._updating = false;
    }

    _removeKnownIndicator(indicatorId) {
        this._updating = true;
        const known = this._settings.get_value(
            this._settingsKey.KNOWN_INDICATORS
        ).deep_unpack();
        const filtered =
            known.filter(pair => pair[0] !== indicatorId);
        if (filtered.length !== known.length) {
            this._settings.set_value(
                this._settingsKey.KNOWN_INDICATORS,
                new GLib.Variant('a(ss)', filtered)
            );
        }
        this._updating = false;
        this._syncFromSettings();
    }
});
