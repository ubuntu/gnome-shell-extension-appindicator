/* exported  GeneralPage*/

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const IconData = GObject.registerClass({
    GTypeName: 'IconData',
    Properties: {
        'id': GObject.ParamSpec.string(
            'id',
            'Id',
            'A read and write string property',
            GObject.ParamFlags.READWRITE,
            ''
        ),
        'name': GObject.ParamSpec.string(
            'name',
            'Name',
            'A read and write string property',
            GObject.ParamFlags.READWRITE,
            ''
        ),
        'at-name': GObject.ParamSpec.string(
            'at-name',
            'At Name',
            'A read and write string property',
            GObject.ParamFlags.READWRITE,
            ''
        ),

    },
}, class IconData extends GObject.Object {
    constructor(props = {}) {
        super(props);
    }

    get id() {
        if (this._id === 'undefined')
            this._id = null;
        return this._id;
    }

    set id(value) {
        if (this.id === value)
            return;

        this._id = value;
        this.notify('id');
    }

    get name() {
        if (this._name === 'undefined')
            this._name = null;
        return this._name;
    }

    set name(value) {
        if (this.name === value)
            return;

        this._name = value;
        this.notify('name');
    }

    get atName() {
        if (this._atName === 'undefined')
            this._atName = null;
        return this._atName;
    }

    set atName(value) {
        if (this.atName === value)
            return;

        this._atName = value;
        this.notify('at-name');
    }
});

export var CustomIconPage = GObject.registerClass(
class AppIndicatorCustomIconPage extends Adw.PreferencesPage {
    _init(settings, settingsKey) {
        super._init({
            title: _('Custom Icons'),
            icon_name: 'custom-icons-symbolic',
            name: 'Custom Icons Page',
        });
        this._settings = settings;
        this._settingsKey = settingsKey;

        this.group = new Adw.PreferencesGroup();

        this.container = new Gtk.Box({
            halign: Gtk.Align.FILL,
            hexpand: true,
            orientation: Gtk.Orientation.VERTICAL,
        });

        this.listStore = new Gio.ListStore({
            item_type: IconData,
        });

        const initList = this._settings.get_value(this._settingsKey.CUSTOM_ICONS).deep_unpack();
        initList.forEach(pair => {
            let data = new IconData({
                id: pair[0],
                name: pair[1],
                atName: pair[2],
            });
            this.listStore.append(data);
        });

        this.listStore.append(new IconData({id: '', name: '', atName: ''}));

        this.selectionModel = new Gtk.SingleSelection({
            model: this.listStore,
        });

        this.columnView = new Gtk.ColumnView({
            hexpand: true,
            model: this.selectionModel,
            reorderable: false,
        });

        const columnTitles =  [
            _('Indicator ID'),
            _('Icon Name'),
            _('Attention Icon Name'),
        ];
        const indicatorIdColumn = new Gtk.ColumnViewColumn({
            title: columnTitles[0],
            expand: true,
        });
        const iconNameColumn = new Gtk.ColumnViewColumn({
            title: columnTitles[1],
            expand: true,
        });
        const attentionIconNameColumn = new Gtk.ColumnViewColumn({
            title: columnTitles[2],
            expand: true,
        });


        const factoryId = new Gtk.SignalListItemFactory();
        factoryId.connect('setup', (_widget, item) => {
            const label = new Gtk.EditableLabel({text: ''});
            item.set_child(label);
        });
        factoryId.connect('bind', (_widget, item) => {
            const label = item.get_child();
            const data = item.get_item();
            label.set_text(data.id);
            label.bind_property('text', data, 'id', GObject.BindingFlags.SYNC_CREATE);
            label.connect('changed', () => this._autoSave(item));
        });

        const factoryName = new Gtk.SignalListItemFactory();
        factoryName.connect('setup', (_widget, item) => {
            const label = new Gtk.EditableLabel({text: ''});
            item.set_child(label);
        });
        factoryName.connect('bind', (_widget, item) => {
            const label = item.get_child();
            const data = item.get_item();
            label.set_text(data.name);
            label.bind_property('text', data, 'name', GObject.BindingFlags.SYNC_CREATE);
            label.connect('changed', () => this._autoSave(item));
        });

        const factoryItName = new Gtk.SignalListItemFactory();
        factoryItName.connect('setup', (_widget, item) => {
            const label = new Gtk.EditableLabel({text: ''});
            item.set_child(label);
        });
        factoryItName.connect('bind', (_widget, item) => {
            const label = item.get_child();
            const data = item.get_item();
            label.set_text(data.atName);
            label.bind_property('text', data, 'at-name', GObject.BindingFlags.SYNC_CREATE);
            label.connect('changed', () => this._autoSave(item));
        });

        indicatorIdColumn.set_factory(factoryId);
        iconNameColumn.set_factory(factoryName);
        attentionIconNameColumn.set_factory(factoryItName);

        this.columnView.append_column(indicatorIdColumn);
        this.columnView.append_column(iconNameColumn);
        this.columnView.append_column(attentionIconNameColumn);

        this.container.append(this.columnView);

        this.group.add(this.container);
        this.add(this.group);
    }

    _autoSave(item) {
        const storeLength = this.listStore.get_n_items();
        const newStore = [];

        for (let i = 0; i < storeLength; i++) {
            const currentItem = this.listStore.get_item(i);
            const id = currentItem.id;
            const name = currentItem.name;
            const atName = currentItem.atName;
            if (id && name)
                newStore.push([id, name, atName || '']);
        }

        this._settings.set_value(this._settingsKey.CUSTOM_ICONS,
            new GLib.Variant('a(sss)', newStore));

        const id = item.get_item().id;
        const name = item.get_item().name;

        /* dynamic new entry*/
        if (storeLength === 1 && (id || name))
            this.listStore.append(new IconData({id: '', name: '', atName: ''}));

        if (storeLength > 1) {
            if ((id || name) && item.get_position() >= storeLength - 1)
                this.listStore.append(new IconData({id: '', name: '', atName: ''}));
        }
    }

    _autoDelete(item) {
        const storeLength = this.listStore.get_n_items();
        const id = item.get_item().id;
        const name = item.get_item().name;
        if (storeLength > 1 && !id && !name &&
            item.get_position() < storeLength - 1)
            this.listStore.remove(item.get_position());
    }
});


