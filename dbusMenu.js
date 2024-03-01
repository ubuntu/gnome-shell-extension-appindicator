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
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';

import * as DBusInterfaces from './interfaces.js';
import * as PromiseUtils from './promiseUtils.js';
import * as Util from './util.js';
import {DBusProxy} from './dbusProxy.js';

Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_async');

// ////////////////////////////////////////////////////////////////////////
// PART ONE: "ViewModel" backend implementation.
// Both code and design are inspired by libdbusmenu
// ////////////////////////////////////////////////////////////////////////

/**
 * Saves menu property values and handles type checking and defaults
 */
export class PropertyStore {
    constructor(initialProperties) {
        this._props = new Map();

        if (initialProperties) {
            for (const [prop, value] of Object.entries(initialProperties))
                this.set(prop, value);
        }
    }

    set(name, value) {
        if (name in PropertyStore.MandatedTypes && value &&
            !value.is_of_type(PropertyStore.MandatedTypes[name]))
            Util.Logger.warn(`Cannot set property ${name}: type mismatch!`);
        else if (value)
            this._props.set(name, value);
        else
            this._props.delete(name);
    }

    get(name) {
        const prop = this._props.get(name);
        if (prop)
            return prop;
        else if (name in PropertyStore.DefaultValues)
            return PropertyStore.DefaultValues[name];
        else
            return null;
    }
}

// we list all the properties we know and use here, so we won' have to deal with unexpected type mismatches
PropertyStore.MandatedTypes = {
    'visible': GLib.VariantType.new('b'),
    'enabled': GLib.VariantType.new('b'),
    'label': GLib.VariantType.new('s'),
    'type': GLib.VariantType.new('s'),
    'children-display': GLib.VariantType.new('s'),
    'icon-name': GLib.VariantType.new('s'),
    'icon-data': GLib.VariantType.new('ay'),
    'toggle-type': GLib.VariantType.new('s'),
    'toggle-state': GLib.VariantType.new('i'),
};

PropertyStore.DefaultValues = {
    'visible': GLib.Variant.new_boolean(true),
    'enabled': GLib.Variant.new_boolean(true),
    'label': GLib.Variant.new_string(''),
    'type': GLib.Variant.new_string('standard'),
    // elements not in here must return null
};

/**
 * Represents a single menu item
 */
export class DbusMenuItem extends Signals.EventEmitter {
    // will steal the properties object
    constructor(client, id, properties, childrenIds) {
        super();

        this._client = client;
        this._id = id;
        this._propStore = new PropertyStore(properties);
        this._children_ids = childrenIds;
    }

    propertyGet(propName) {
        const prop = this.propertyGetVariant(propName);
        return prop ? prop.get_string()[0] : null;
    }

    propertyGetVariant(propName) {
        return this._propStore.get(propName);
    }

    propertyGetBool(propName) {
        const prop  = this.propertyGetVariant(propName);
        return prop ? prop.get_boolean() : false;
    }

    propertyGetInt(propName) {
        const prop = this.propertyGetVariant(propName);
        return prop ? prop.get_int32() : 0;
    }

    propertySet(prop, value) {
        this._propStore.set(prop, value);

        this.emit('property-changed', prop, this.propertyGetVariant(prop));
    }

    resetProperties() {
        Object.entries(PropertyStore.DefaultValues).forEach(([prop, value]) =>
            this.propertySet(prop, value));
    }

    getChildrenIds() {
        return this._children_ids.concat(); // clone it!
    }

    addChild(pos, childId) {
        this._children_ids.splice(pos, 0, childId);
        this.emit('child-added', this._client.getItem(childId), pos);
    }

    removeChild(childId) {
        // find it
        let pos = -1;
        for (let i = 0; i < this._children_ids.length; ++i) {
            if (this._children_ids[i] === childId) {
                pos = i;
                break;
            }
        }

        if (pos < 0) {
            Util.Logger.critical("Trying to remove child which doesn't exist");
        } else {
            this._children_ids.splice(pos, 1);
            this.emit('child-removed', this._client.getItem(childId));
        }
    }

    moveChild(childId, newPos) {
        // find the old position
        let oldPos = -1;
        for (let i = 0; i < this._children_ids.length; ++i) {
            if (this._children_ids[i] === childId) {
                oldPos = i;
                break;
            }
        }

        if (oldPos < 0) {
            Util.Logger.critical("tried to move child which wasn't in the list");
            return;
        }

        if (oldPos !== newPos) {
            this._children_ids.splice(oldPos, 1);
            this._children_ids.splice(newPos, 0, childId);
            this.emit('child-moved', oldPos, newPos, this._client.getItem(childId));
        }
    }

    getChildren() {
        return this._children_ids.map(el => this._client.getItem(el));
    }

    handleEvent(event, data, timestamp) {
        if (!data)
            data = GLib.Variant.new_int32(0);

        this._client.sendEvent(this._id, event, data, timestamp);
    }

    getId() {
        return this._id;
    }

    sendAboutToShow() {
        this._client.sendAboutToShow(this._id);
    }
}


/**
 * The client does the heavy lifting of actually reading layouts and distributing events
 */

export const DBusClient = GObject.registerClass({
    Signals: {'ready-changed': {}},
}, class AppIndicatorsDBusClient extends DBusProxy {
    static get interfaceInfo() {
        if (!this._interfaceInfo) {
            this._interfaceInfo = Gio.DBusInterfaceInfo.new_for_xml(
                DBusInterfaces.DBusMenu);
        }
        return this._interfaceInfo;
    }

    static get baseItems() {
        if (!this._baseItems) {
            this._baseItems = {
                'children-display': GLib.Variant.new_string('submenu'),
            };
        }
        return this._baseItems;
    }

    static destroy() {
        delete this._interfaceInfo;
    }

    _init(busName, objectPath) {
        const {interfaceInfo} = AppIndicatorsDBusClient;

        super._init(busName, objectPath, interfaceInfo,
            Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES);

        this._items = new Map();
        this._items.set(0, new DbusMenuItem(this, 0, DBusClient.baseItems, []));
        this._flagItemsUpdateRequired = false;

        // will be set to true if a layout update is needed once active
        this._flagLayoutUpdateRequired = false;

        // property requests are queued
        this._propertiesRequestedFor = new Set(/* ids */);

        this._layoutUpdated = false;
        this._active = false;
    }

    async initAsync(cancellable) {
        await super.initAsync(cancellable);

        this._requestLayoutUpdate();
    }

    _onNameOwnerChanged() {
        if (this.isReady)
            this._requestLayoutUpdate();
    }

    get isReady() {
        return this._layoutUpdated && !!this.gNameOwner;
    }

    get cancellable() {
        return this._cancellable;
    }

    getRoot() {
        return this._items.get(0);
    }

    _requestLayoutUpdate() {
        const cancellable = new Util.CancellableChild(this._cancellable);
        this._beginLayoutUpdate(cancellable);
    }

    async _requestProperties(propertyId, cancellable) {
        this._propertiesRequestedFor.add(propertyId);

        if (this._propertiesRequest && this._propertiesRequest.pending())
            return;

        // if we don't have any requests queued, we'll need to add one
        this._propertiesRequest = new PromiseUtils.IdlePromise(
            GLib.PRIORITY_DEFAULT_IDLE, cancellable);
        await this._propertiesRequest;

        const requestedProperties = Array.from(this._propertiesRequestedFor);
        this._propertiesRequestedFor.clear();
        const [result] = await this.GetGroupPropertiesAsync(requestedProperties,
            [], cancellable);

        result.forEach(([id, properties]) => {
            const item = this._items.get(id);
            if (!item)
                return;

            item.resetProperties();

            for (const [prop, value] of Object.entries(properties))
                item.propertySet(prop, value);
        });
    }

    // Traverses the list of cached menu items and removes everyone that is not in the list
    // so we don't keep alive unused items
    _gcItems() {
        const tag = new Date().getTime();

        const toTraverse = [0];
        while (toTraverse.length > 0) {
            const item = this.getItem(toTraverse.shift());
            item._dbusClientGcTag = tag;
            Array.prototype.push.apply(toTraverse, item.getChildrenIds());
        }

        this._items.forEach((i, id) => {
            if (i._dbusClientGcTag !== tag)
                this._items.delete(id);
        });
    }

    // the original implementation will only request partial layouts if somehow possible
    // we try to save us from multiple kinds of race conditions by always requesting a full layout
    _beginLayoutUpdate(cancellable) {
        this._layoutUpdateUpdateAsync(cancellable).catch(e => {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
        });
    }

    // the original implementation will only request partial layouts if somehow possible
    // we try to save us from multiple kinds of race conditions by always requesting a full layout
    async _layoutUpdateUpdateAsync(cancellable) {
        // we only read the type property, because if the type changes after reading all properties,
        // the view would have to replace the item completely which we try to avoid
        if (this._layoutUpdateCancellable)
            this._layoutUpdateCancellable.cancel();

        this._layoutUpdateCancellable = cancellable;

        try {
            const [revision_, root] = await this.GetLayoutAsync(0, -1,
                ['type', 'children-display'], cancellable);

            this._updateLayoutState(true);
            this._doLayoutUpdate(root, cancellable);
            this._gcItems();
            this._flagLayoutUpdateRequired = false;
            this._flagItemsUpdateRequired = false;
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                this._updateLayoutState(false);
            throw e;
        } finally {
            if (this._layoutUpdateCancellable === cancellable)
                this._layoutUpdateCancellable = null;
        }
    }

    _updateLayoutState(state) {
        const wasReady = this.isReady;
        this._layoutUpdated = state;
        if (this.isReady !== wasReady)
            this.emit('ready-changed');
    }

    _doLayoutUpdate(item, cancellable) {
        const [id, properties, children] = item;

        const childrenUnpacked = children.map(c => c.deep_unpack());
        const childrenIds = childrenUnpacked.map(([c]) => c);

        // make sure all our children exist
        childrenUnpacked.forEach(c => this._doLayoutUpdate(c, cancellable));

        // make sure we exist
        const menuItem = this._items.get(id);

        if (menuItem) {
            // we do, update our properties if necessary
            for (const [prop, value] of Object.entries(properties))
                menuItem.propertySet(prop, value);

            // make sure our children are all at the right place, and exist
            const oldChildrenIds = menuItem.getChildrenIds();
            for (let i = 0; i < childrenIds.length; ++i) {
                // try to recycle an old child
                let oldChild = -1;
                for (let j = 0; j < oldChildrenIds.length; ++j) {
                    if (oldChildrenIds[j] === childrenIds[i]) {
                        [oldChild] = oldChildrenIds.splice(j, 1);
                        break;
                    }
                }

                if (oldChild < 0) {
                    // no old child found, so create a new one!
                    menuItem.addChild(i, childrenIds[i]);
                } else {
                    // old child found, reuse it!
                    menuItem.moveChild(childrenIds[i], i);
                }
            }

            // remove any old children that weren't reused
            oldChildrenIds.forEach(c => menuItem.removeChild(c));

            if (!this._flagItemsUpdateRequired)
                return id;
        }

        // we don't, so let's create us
        let newMenuItem = menuItem;

        if (!newMenuItem) {
            newMenuItem = new DbusMenuItem(this, id, properties, childrenIds);
            this._items.set(id, newMenuItem);
        }

        this._requestProperties(id, cancellable).catch(e => {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.warn(`Could not get menu properties menu proxy: ${e}`);
        });

        return id;
    }

    async _doPropertiesUpdateAsync(cancellable) {
        if (this._propertiesUpdateCancellable)
            this._propertiesUpdateCancellable.cancel();

        this._propertiesUpdateCancellable = cancellable;

        try {
            const requests = [];

            this._items.forEach((_, id) =>
                requests.push(this._requestProperties(id, cancellable)));

            await Promise.all(requests);
        } finally {
            if (this._propertiesUpdateCancellable === cancellable)
                this._propertiesUpdateCancellable = null;
        }
    }

    _doPropertiesUpdate() {
        const cancellable = new Util.CancellableChild(this._cancellable);
        this._doPropertiesUpdateAsync(cancellable).catch(e => {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                Util.Logger.warn(`Could not get menu properties menu proxy: ${e}`);
        });
    }


    set active(active) {
        const wasActive = this._active;
        this._active = active;

        if (active && wasActive !== active) {
            if (this._flagLayoutUpdateRequired) {
                this._requestLayoutUpdate();
            } else if (this._flagItemsUpdateRequired) {
                this._doPropertiesUpdate();
                this._flagItemsUpdateRequired = false;
            }
        }
    }

    _onSignal(_sender, signal, params) {
        if (signal === 'LayoutUpdated') {
            if (!this._active) {
                this._flagLayoutUpdateRequired = true;
                return;
            }

            this._requestLayoutUpdate();
        } else if (signal === 'ItemsPropertiesUpdated') {
            if (!this._active) {
                this._flagItemsUpdateRequired = true;
                return;
            }

            this._onPropertiesUpdated(params.deep_unpack());
        }
    }

    getItem(id) {
        const item = this._items.get(id);
        if (!item)
            Util.Logger.warn(`trying to retrieve item for non-existing id ${id} !?`);
        return item || null;
    }

    // we don't need to cache and burst-send that since it will not happen that frequently
    async sendAboutToShow(id) {
        if (this._hasAboutToShow === false)
            return;

        /* Some indicators (you, dropbox!) don't use the right signature
         * and don't return a boolean, so we need to support both cases */
        try {
            const ret = await this.gConnection.call(this.gName, this.gObjectPath,
                this.gInterfaceName, 'AboutToShow', new GLib.Variant('(i)', [id]),
                null, Gio.DBusCallFlags.NONE, -1, this._cancellable);

            if ((ret.is_of_type(new GLib.VariantType('(b)')) &&
                 ret.get_child_value(0).get_boolean()) ||
                ret.is_of_type(new GLib.VariantType('()')))
                this._requestLayoutUpdate();
        } catch (e) {
            Util.Logger.debug('Error when calling \'AboutToShow()\' in ' +
                `${this.gName}, ${this.gObjectPath}, ${this.gInterfaceName}`);
            if (e.matches(Gio.DBusError, Gio.DBusError.UNKNOWN_METHOD) ||
                e.matches(Gio.DBusError, Gio.DBusError.FAILED)) {
                this._hasAboutToShow = false;
                return;
            }
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
        }
    }

    sendEvent(id, event, params, timestamp) {
        if (!this.gNameOwner)
            return;

        this.EventAsync(id, event, params, timestamp, this._cancellable).catch(e => {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
        });
    }

    _onPropertiesUpdated([changed, removed]) {
        changed.forEach(([id, props]) => {
            const item = this._items.get(id);
            if (!item)
                return;

            for (const [prop, value] of Object.entries(props))
                item.propertySet(prop, value);
        });
        removed.forEach(([id, propNames]) => {
            const item = this._items.get(id);
            if (!item)
                return;

            propNames.forEach(propName => item.propertySet(propName, null));
        });
    }
});

// ////////////////////////////////////////////////////////////////////////
// PART TWO: "View" frontend implementation.
// ////////////////////////////////////////////////////////////////////////

// https://bugzilla.gnome.org/show_bug.cgi?id=731514
// GNOME 3.10 and 3.12 can't open a nested submenu.
// Patches have been written, but it's not clear when (if?) they will be applied.
// We also don't know whether they will be backported to 3.10, so we will work around
// it in the meantime. Offending versions can be clearly identified:
const NEED_NESTED_SUBMENU_FIX = '_setOpenedSubMenu' in PopupMenu.PopupMenu.prototype;

/**
 * Creates new wrapper menu items and injects methods for managing them at runtime.
 *
 * Many functions in this object will be bound to the created item and executed as event
 * handlers, so any `this` will refer to a menu item create in createItem
 */
const MenuItemFactory = {
    createItem(client, dbusItem) {
        // first, decide whether it's a submenu or not
        let shellItem;
        if (dbusItem.propertyGet('children-display') === 'submenu')
            shellItem = new PopupMenu.PopupSubMenuMenuItem('FIXME');
        else if (dbusItem.propertyGet('type') === 'separator')
            shellItem = new PopupMenu.PopupSeparatorMenuItem('');
        else
            shellItem = new PopupMenu.PopupMenuItem('FIXME');

        shellItem._dbusItem = dbusItem;
        shellItem._dbusClient = client;

        if (shellItem instanceof PopupMenu.PopupMenuItem) {
            shellItem._icon = new St.Icon({
                style_class: 'popup-menu-icon',
                xAlign: Clutter.ActorAlign.END,
            });
            shellItem.add_child(shellItem._icon);
            shellItem.label.x_expand = true;
        }

        // initialize our state
        MenuItemFactory._updateLabel.call(shellItem);
        MenuItemFactory._updateOrnament.call(shellItem);
        MenuItemFactory._updateImage.call(shellItem);
        MenuItemFactory._updateVisible.call(shellItem);
        MenuItemFactory._updateSensitive.call(shellItem);

        // initially create children
        if (shellItem instanceof PopupMenu.PopupSubMenuMenuItem) {
            dbusItem.getChildren().forEach(c =>
                shellItem.menu.addMenuItem(MenuItemFactory.createItem(client, c)));
        }

        // now, connect various events
        Util.connectSmart(dbusItem, 'property-changed',
            shellItem, MenuItemFactory._onPropertyChanged);
        Util.connectSmart(dbusItem, 'child-added',
            shellItem, MenuItemFactory._onChildAdded);
        Util.connectSmart(dbusItem, 'child-removed',
            shellItem, MenuItemFactory._onChildRemoved);
        Util.connectSmart(dbusItem, 'child-moved',
            shellItem, MenuItemFactory._onChildMoved);
        Util.connectSmart(shellItem, 'activate',
            shellItem, MenuItemFactory._onActivate);

        shellItem.connect('destroy', () => {
            shellItem._dbusItem = null;
            shellItem._dbusClient = null;
            shellItem._icon = null;
        });

        if (shellItem.menu) {
            Util.connectSmart(shellItem.menu, 'open-state-changed',
                shellItem,  MenuItemFactory._onOpenStateChanged);
        }

        return shellItem;
    },

    _onOpenStateChanged(menu, open) {
        if (open) {
            if (NEED_NESTED_SUBMENU_FIX) {
                // close our own submenus
                if (menu._openedSubMenu)
                    menu._openedSubMenu.close(false);

                // register ourselves and close sibling submenus
                if (menu._parent._openedSubMenu && menu._parent._openedSubMenu !== menu)
                    menu._parent._openedSubMenu.close(true);

                menu._parent._openedSubMenu = menu;
            }

            this._dbusItem.handleEvent('opened', null, 0);
            this._dbusItem.sendAboutToShow();
        } else {
            if (NEED_NESTED_SUBMENU_FIX) {
                // close our own submenus
                if (menu._openedSubMenu)
                    menu._openedSubMenu.close(false);
            }

            this._dbusItem.handleEvent('closed', null, 0);
        }
    },

    _onActivate(_item, event) {
        const timestamp = event.get_time();
        if (timestamp && this._dbusClient.indicator)
            this._dbusClient.indicator.provideActivationToken(timestamp);

        this._dbusItem.handleEvent('clicked', GLib.Variant.new('i', 0),
            timestamp);
    },

    _onPropertyChanged(dbusItem, prop, _value) {
        if (prop === 'toggle-type' || prop === 'toggle-state')
            MenuItemFactory._updateOrnament.call(this);
        else if (prop === 'label')
            MenuItemFactory._updateLabel.call(this);
        else if (prop === 'enabled')
            MenuItemFactory._updateSensitive.call(this);
        else if (prop === 'visible')
            MenuItemFactory._updateVisible.call(this);
        else if (prop === 'icon-name' || prop === 'icon-data')
            MenuItemFactory._updateImage.call(this);
        else if (prop === 'type' || prop === 'children-display')
            MenuItemFactory._replaceSelf.call(this);
        else
            Util.Logger.debug(`Unhandled property change: ${prop}`);
    },

    _onChildAdded(dbusItem, child, position) {
        if (!(this instanceof PopupMenu.PopupSubMenuMenuItem)) {
            Util.Logger.warn('Tried to add a child to non-submenu item. Better recreate it as whole');
            MenuItemFactory._replaceSelf.call(this);
        } else {
            this.menu.addMenuItem(MenuItemFactory.createItem(this._dbusClient, child), position);
        }
    },

    _onChildRemoved(dbusItem, child) {
        if (!(this instanceof PopupMenu.PopupSubMenuMenuItem)) {
            Util.Logger.warn('Tried to remove a child from non-submenu item. Better recreate it as whole');
            MenuItemFactory._replaceSelf.call(this);
        } else {
            // find it!
            this.menu._getMenuItems().forEach(item => {
                if (item._dbusItem === child)
                    item.destroy();
            });
        }
    },

    _onChildMoved(dbusItem, child, oldpos, newpos) {
        if (!(this instanceof PopupMenu.PopupSubMenuMenuItem)) {
            Util.Logger.warn('Tried to move a child in non-submenu item. Better recreate it as whole');
            MenuItemFactory._replaceSelf.call(this);
        } else {
            MenuUtils.moveItemInMenu(this.menu, child, newpos);
        }
    },

    _updateLabel() {
        const label = this._dbusItem.propertyGet('label').replace(/_([^_])/, '$1');

        if (this.label) // especially on GS3.8, the separator item might not even have a hidden label
            this.label.set_text(label);
    },

    _updateOrnament() {
        if (!this.setOrnament)
            return; // separators and alike might not have gotten the polyfill

        if (this._dbusItem.propertyGet('toggle-type') === 'checkmark' &&
            this._dbusItem.propertyGetInt('toggle-state'))
            this.setOrnament(PopupMenu.Ornament.CHECK);
        else if (this._dbusItem.propertyGet('toggle-type') === 'radio' &&
                 this._dbusItem.propertyGetInt('toggle-state'))
            this.setOrnament(PopupMenu.Ornament.DOT);
        else
            this.setOrnament(PopupMenu.Ornament.NONE);
    },

    async _updateImage() {
        if (!this._icon)
            return; // might be missing on submenus / separators

        const iconName = this._dbusItem.propertyGet('icon-name');
        const iconData = this._dbusItem.propertyGetVariant('icon-data');
        if (iconName) {
            this._icon.icon_name = iconName;
        } else if (iconData) {
            try {
                const inputStream = Gio.MemoryInputStream.new_from_bytes(
                    iconData.get_data_as_bytes());
                this._icon.gicon = await GdkPixbuf.Pixbuf.new_from_stream_async(
                    inputStream, this._dbusClient.cancellable);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    logError(e);
            }
        }
    },

    _updateVisible() {
        this.visible = this._dbusItem.propertyGetBool('visible');
    },

    _updateSensitive() {
        this.setSensitive(this._dbusItem.propertyGetBool('enabled'));
    },

    _replaceSelf(newSelf) {
        // create our new self if needed
        if (!newSelf)
            newSelf = MenuItemFactory.createItem(this._dbusClient, this._dbusItem);

        // first, we need to find our old position
        let pos = -1;
        const family = this._parent._getMenuItems();
        for (let i = 0; i < family.length; ++i) {
            if (family[i] === this)
                pos = i;
        }

        if (pos < 0)
            throw new Error("DBusMenu: can't replace non existing menu item");


        // add our new self while we're still alive
        this._parent.addMenuItem(newSelf, pos);

        // now destroy our old self
        this.destroy();
    },
};

/**
 * Utility functions not necessarily belonging into the item factory
 */
const MenuUtils = {
    moveItemInMenu(menu, dbusItem, newpos) {
        // HACK: we're really getting into the internals of the PopupMenu implementation

        // First, find our wrapper. Children tend to lie. We do not trust the old positioning.
        const family = menu._getMenuItems();
        for (let i = 0; i < family.length; ++i) {
            if (family[i]._dbusItem === dbusItem) {
                // now, remove it
                menu.box.remove_child(family[i]);

                // and add it again somewhere else
                if (newpos < family.length && family[newpos] !== family[i])
                    menu.box.insert_child_below(family[i], family[newpos]);
                else
                    menu.box.add(family[i]);

                // skip the rest
                return;
            }
        }
    },
};


/**
 * Processes DBus events, creates the menu items and handles the actions
 *
 * Something like a mini-god-object
 */
export class Client extends Signals.EventEmitter {
    constructor(busName, path, indicator) {
        super();

        this._busName  = busName;
        this._busPath  = path;
        this._client   = new DBusClient(busName, path);
        this._rootMenu = null; // the shell menu
        this._rootItem = null; // the DbusMenuItem for the root
        this.indicator = indicator;
        this.cancellable = new Util.CancellableChild(this.indicator.cancellable);

        this._client.initAsync(this.cancellable).catch(e => {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
        });

        Util.connectSmart(this._client, 'ready-changed', this,
            () => this.emit('ready-changed'));
    }

    get isReady() {
        return this._client.isReady;
    }

    // this will attach the client to an already existing menu that will be used as the root menu.
    // it will also connect the client to be automatically destroyed when the menu dies.
    attachToMenu(menu) {
        this._rootMenu = menu;
        this._rootItem = this._client.getRoot();
        this._itemsBeingAdded = new Set();

        // cleanup: remove existing children (just in case)
        this._rootMenu.removeAll();

        if (NEED_NESTED_SUBMENU_FIX)
            menu._setOpenedSubMenu = this._setOpenedSubmenu.bind(this);

        // connect handlers
        Util.connectSmart(menu, 'open-state-changed', this, this._onMenuOpened);
        Util.connectSmart(menu, 'destroy', this, this.destroy);

        Util.connectSmart(this._rootItem, 'child-added', this, this._onRootChildAdded);
        Util.connectSmart(this._rootItem, 'child-removed', this, this._onRootChildRemoved);
        Util.connectSmart(this._rootItem, 'child-moved', this, this._onRootChildMoved);

        // Dropbox requires us to call AboutToShow(0) first
        this._rootItem.sendAboutToShow();

        // fill the menu for the first time
        const children = this._rootItem.getChildren();
        children.forEach(child =>
            this._onRootChildAdded(this._rootItem, child));
    }

    _setOpenedSubmenu(submenu) {
        if (!submenu)
            return;

        if (submenu._parent !== this._rootMenu)
            return;

        if (submenu === this._openedSubMenu)
            return;

        if (this._openedSubMenu && this._openedSubMenu.isOpen)
            this._openedSubMenu.close(true);

        this._openedSubMenu = submenu;
    }

    _onRootChildAdded(dbusItem, child, position) {
        // Menu additions can be expensive, so let's do it in different chunks
        const basePriority = this.isOpen ? GLib.PRIORITY_DEFAULT : GLib.PRIORITY_LOW;
        const idlePromise = new PromiseUtils.IdlePromise(
            basePriority + this._itemsBeingAdded.size, this.cancellable);
        this._itemsBeingAdded.add(child);

        idlePromise.then(() => {
            if (!this._itemsBeingAdded.has(child))
                return;

            this._rootMenu.addMenuItem(
                MenuItemFactory.createItem(this, child), position);
        }).catch(e => {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                logError(e);
        }).finally(() => this._itemsBeingAdded.delete(child));
    }

    _onRootChildRemoved(dbusItem, child) {
        // children like to play hide and seek
        // but we know how to find it for sure!
        const item = this._rootMenu._getMenuItems().find(it =>
            it._dbusItem === child);

        if (item)
            item.destroy();
        else
            this._itemsBeingAdded.delete(child);
    }

    _onRootChildMoved(dbusItem, child, oldpos, newpos) {
        MenuUtils.moveItemInMenu(this._rootMenu, dbusItem, newpos);
    }

    _onMenuOpened(menu, state) {
        if (!this._rootItem)
            return;

        this._client.active = state;

        if (state) {
            if (this._openedSubMenu && this._openedSubMenu.isOpen)
                this._openedSubMenu.close();

            this._rootItem.handleEvent('opened', null, 0);
            this._rootItem.sendAboutToShow();
        } else {
            this._rootItem.handleEvent('closed', null, 0);
        }
    }

    destroy() {
        this.emit('destroy');

        if (this._client)
            this._client.destroy();

        this._client   = null;
        this._rootItem = null;
        this._rootMenu = null;
        this.indicator = null;
        this._itemsBeingAdded = null;
    }
}
