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
const Atk = imports.gi.Atk
const Clutter = imports.gi.Clutter
const Gio = imports.gi.Gio
const GLib = imports.gi.GLib
const GdkPixbuf = imports.gi.GdkPixbuf
const Lang = imports.lang
const PopupMenu = imports.ui.popupMenu
const Signals = imports.signals
const St = imports.gi.St

const Extension = imports.misc.extensionUtils.getCurrentExtension()

const DBusInterfaces = Extension.imports.interfaces
const Util = Extension.imports.util

//////////////////////////////////////////////////////////////////////////
// PART ONE: "ViewModel" backend implementation.
// Both code and design are inspired by libdbusmenu
//////////////////////////////////////////////////////////////////////////

/**
 * Saves menu property values and handles type checking and defaults
 */
const PropertyStore = new Lang.Class({
    Name: 'DbusMenuPropertyStore',

    _init: function(initial_properties) {
        this._props = {}

        if (initial_properties) {
            for (let i in initial_properties) {
                this.set(i, initial_properties[i])
            }
        }
    },

    set: function(name, value) {
        if (name in PropertyStore.MandatedTypes && value && !value.is_of_type(PropertyStore.MandatedTypes[name]))
            Util.Logger.warn("Cannot set property "+name+": type mismatch!")
        else if (value)
            this._props[name] = value
        else
            delete this._props[name]
    },

    get: function(name) {
        if (name in this._props)
            return this._props[name]
        else if (name in PropertyStore.DefaultValues)
            return PropertyStore.DefaultValues[name]
        else
            return null
    }
})

// we list all the properties we know and use here, so we won' have to deal with unexpected type mismatches
PropertyStore.MandatedTypes = {
    'visible'           : GLib.VariantType.new("b"),
    'enabled'           : GLib.VariantType.new("b"),
    'label'             : GLib.VariantType.new("s"),
    'type'              : GLib.VariantType.new("s"),
    'children-display'  : GLib.VariantType.new("s"),
    'icon-name'         : GLib.VariantType.new("s"),
    'icon-data'         : GLib.VariantType.new("ay"),
    'toggle-type'       : GLib.VariantType.new("s"),
    'toggle-state'      : GLib.VariantType.new("i")
}

PropertyStore.DefaultValues = {
    'visible': GLib.Variant.new_boolean(true),
    'enabled': GLib.Variant.new_boolean(true),
    'label'  : GLib.Variant.new_string(''),
    'type'   : GLib.Variant.new_string("standard")
    // elements not in here must return null
}

/**
 * Represents a single menu item
 */
const DbusMenuItem = new Lang.Class({
    Name: 'DbusMenuItem',

    // will steal the properties object
    _init: function(client, id, properties, children_ids) {
        this._client = client
        this._id = id
        this._propStore = new PropertyStore(properties)
        this._children_ids = children_ids
    },

    property_get: function(prop_name) {
        let prop = this.property_get_variant(prop_name)
        return prop ? prop.get_string()[0] : null
    },

    property_get_variant: function(prop_name) {
        return this._propStore.get(prop_name)
    },

    property_get_bool: function(prop_name) {
        let prop  = this.property_get_variant(prop_name)
        return prop ? prop.get_boolean() : false
    },

    property_get_int: function(prop_name) {
        let prop = this.property_get_variant(prop_name)
        return prop ? prop.get_int32() : 0
    },

    property_set: function(prop, value) {
        this._propStore.set(prop, value)

        this.emit('property-changed', prop, this.property_get_variant(prop))
    },

    get_children_ids: function() {
        return this._children_ids.concat() // clone it!
    },

    add_child: function(pos, child_id) {
        this._children_ids.splice(pos, 0, child_id)
        this.emit('child-added', this._client.get_item(child_id), pos)
    },

    remove_child: function(child_id) {
        // find it
        let pos = -1
        for (let i = 0; i < this._children_ids.length; ++i) {
            if (this._children_ids[i] == child_id) {
                pos = i
                break
            }
        }

        if (pos < 0) {
            Util.Logger.fatal("Trying to remove child which doesn't exist")
        } else {
            this._children_ids.splice(pos, 1)
            this.emit('child-removed', this._client.get_item(child_id))
        }
    },

    move_child: function(child_id, newpos) {
        // find the old position
        let oldpos = -1
        for (let i = 0; i < this._children_ids.length; ++i) {
            if (this._children_ids[i] == child_id) {
                oldpos = i
                break
            }
        }

        if (oldpos < 0) {
            Util.Logger.fatal("tried to move child which wasn't in the list")
            return
        }

        if (oldpos != newpos) {
            this._children_ids.splice(oldpos, 1)
            this._children_ids.splice(newpos, 0, child_id)
            this.emit('child-moved', oldpos, newpos, this._client.get_item(child_id))
        }
    },

    get_children: function() {
        return this._children_ids.map(function(el) {
            return this._client.get_item(el)
        }, this)
    },

    handle_event: function(event, data, timestamp) {
        if (!data)
            data = GLib.Variant.new_int32(0)

        this._client.send_event(this._id, event, data, timestamp)
    },

    get_id: function() {
        return this._id
    },

    send_about_to_show: function() {
        this._client.send_about_to_show(this._id)
    }
})
Signals.addSignalMethods(DbusMenuItem.prototype)


const BusClientProxy = Gio.DBusProxy.makeProxyWrapper(DBusInterfaces.DBusMenu);

/**
 * The client does the heavy lifting of actually reading layouts and distributing events
 */
const DBusClient = new Lang.Class({
    Name: 'DbusMenuBusClient',

    _init: function(busName, busPath) {
        this._proxy = new BusClientProxy(Gio.DBus.session, busName, busPath, this._clientReady.bind(this))
        this._items = { 0: new DbusMenuItem(this, 0, { 'children-display': GLib.Variant.new_string('submenu') }, []) }

        // will be set to true if a layout update is requested while one is already in progress
        // then the handler that completes the layout update will request another update
        this._flagLayoutUpdateRequired = false
        this._flagLayoutUpdateInProgress = false

        // property requests are queued
        this._propertiesRequestedFor = [ /* ids */ ]
    },

    get_root: function() {
        return this._items[0]
    },

    _requestLayoutUpdate: function() {
        if (this._flagLayoutUpdateInProgress)
            this._flagLayoutUpdateRequired = true
        else
            this._beginLayoutUpdate()
    },

    _requestProperties: function(id) {
        // if we don't have any requests queued, we'll need to add one
        if (this._propertiesRequestedFor.length < 1)
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, this._beginRequestProperties.bind(this))

        if (this._propertiesRequestedFor.filter(function(e) { return e === id }).length == 0)
            this._propertiesRequestedFor.push(id)

    },

    _beginRequestProperties: function() {
        this._proxy.GetGroupPropertiesRemote(this._propertiesRequestedFor, [], this._endRequestProperties.bind(this))

        this._propertiesRequestedFor = []

        return false
    },

    _endRequestProperties: function(result, error) {
        if (error) {
            Util.Logger.warn("Could not retrieve properties: "+error)
            return
        }

        // for some funny reason, the result array is hidden in an array
        result[0].forEach(function([id, properties]) {
            if (!(id in this._items))
                return

            for (let prop in properties)
                this._items[id].property_set(prop, properties[prop])
        }, this)
    },

    // Traverses the list of cached menu items and removes everyone that is not in the list
    // so we don't keep alive unused items
    _gcItems: function() {
        let tag = new Date().getTime()

        let toTraverse = [ 0 ]
        while (toTraverse.length > 0) {
            let item = this.get_item(toTraverse.shift())
            item._dbusClientGcTag = tag
            Array.prototype.push.apply(toTraverse, item.get_children_ids())
        }

        for (let i in this._items)
            if (this._items[i]._dbusClientGcTag != tag)
                delete this._items[i]
    },

    // the original implementation will only request partial layouts if somehow possible
    // we try to save us from multiple kinds of race conditions by always requesting a full layout
    _beginLayoutUpdate: function() {
        // we only read the type property, because if the type changes after reading all properties,
        // the view would have to replace the item completely which we try to avoid
        this._proxy.GetLayoutRemote(0, -1, [ 'type', 'children-display' ], this._endLayoutUpdate.bind(this))

        this._flagLayoutUpdateRequired = false
        this._flagLayoutUpdateInProgress = true
    },

    _endLayoutUpdate: function(result, error) {
        if (error) {
            Util.Logger.warn("While reading menu layout: "+error)
            return
        }

        let [ revision, root ] = result
        this._doLayoutUpdate(root)
        this._gcItems()

        if (this._flagLayoutUpdateRequired)
            this._beginLayoutUpdate()
        else
            this._flagLayoutUpdateInProgress = false
    },

    _doLayoutUpdate: function(item) {
        let [ id, properties, children ] = item

        let children_unpacked = children.map(function(child) { return child.deep_unpack() })
        let children_ids = children_unpacked.map(function(child) { return child[0] })

        // make sure all our children exist
        children_unpacked.forEach(this._doLayoutUpdate, this)

        // make sure we exist
        if (id in this._items) {
            // we do, update our properties if necessary
            for (let prop in properties) {
                this._items[id].property_set(prop, properties[prop])
            }

            // make sure our children are all at the right place, and exist
            let old_children_ids = this._items[id].get_children_ids()
            for (let i = 0; i < children_ids.length; ++i) {
                // try to recycle an old child
                let old_child = -1
                for (let j = 0; j < old_children_ids.length; ++j) {
                    if (old_children_ids[j] == children_ids[i]) {
                        old_child = old_children_ids.splice(j, 1)[0]
                        break
                    }
                }

                if (old_child < 0) {
                    // no old child found, so create a new one!
                    this._items[id].add_child(i, children_ids[i])
                } else {
                    // old child found, reuse it!
                    this._items[id].move_child(children_ids[i], i)
                }
            }

            // remove any old children that weren't reused
            old_children_ids.forEach(function(child_id) { this._items[id].remove_child(child_id) }, this)
        } else {
            // we don't, so let's create us
            this._items[id] = new DbusMenuItem(this, id, properties, children_ids)
            this._requestProperties(id)
        }

        return id
    },

    _clientReady: function(result, error) {
        if (error) {
            Util.Logger.warn("Could not initialize menu proxy: "+error)
            //FIXME: show message to the user?
        }

        this._requestLayoutUpdate()

        // listen for updated layouts and properties
        this._proxy.connectSignal("LayoutUpdated", this._onLayoutUpdated.bind(this))
        this._proxy.connectSignal("ItemsPropertiesUpdated", this._onPropertiesUpdated.bind(this))
    },

    get_item: function(id) {
        if (id in this._items)
            return this._items[id]

        Util.Logger.warn("trying to retrieve item for non-existing id "+id+" !?")
        return null
    },

    // we don't need to cache and burst-send that since it will not happen that frequently
    send_about_to_show: function(id) {
        this._proxy.AboutToShowRemote(id, (function(result, error) {
            if (error)
                Util.Logger.warn("while calling AboutToShow: "+error)
            else if (result && result[0])
                this._requestLayoutUpdate()
        }).bind(this))
    },

    send_event: function(id, event, params, timestamp) {
        if (!this._proxy)
            return

        this._proxy.EventRemote(id, event, params, timestamp, function(result, error) { /* we don't care */ })
    },

    _onLayoutUpdated: function() {
        this._requestLayoutUpdate()
    },

    _onPropertiesUpdated: function(proxy, name, [changed, removed]) {
        changed.forEach(function([id, props]) {
            if (!(id in this._items))
                return

            for (let prop in props)
                this._items[id].property_set(prop, props[prop])
        }, this)
        removed.forEach(function([id, propNames]) {
            if (!(id in this._items))
                return

            propNames.forEach(function(propName) {
                this._items[id].property_set(propName, null)
            }, this)
        }, this)
    },

    destroy: function() {
        this.emit('destroy')

        Signals._disconnectAll.apply(this._proxy)

        this._proxy = null
    }
})
Signals.addSignalMethods(DBusClient.prototype)

//////////////////////////////////////////////////////////////////////////
// PART TWO: "View" frontend implementation.
//////////////////////////////////////////////////////////////////////////

// https://bugzilla.gnome.org/show_bug.cgi?id=731514
// GNOME 3.10 and 3.12 can't open a nested submenu.
// Patches have been written, but it's not clear when (if?) they will be applied.
// We also don't know whether they will be backported to 3.10, so we will work around
// it in the meantime. Offending versions can be clearly identified:
const NEED_NESTED_SUBMENU_FIX = '_setOpenedSubMenu' in PopupMenu.PopupMenu.prototype

/**
 * Creates new wrapper menu items and injects methods for managing them at runtime.
 *
 * Many functions in this object will be bound to the created item and executed as event
 * handlers, so any `this` will refer to a menu item create in createItem
 */
const MenuItemFactory = {
    createItem: function(client, dbusItem) {
        // first, decide whether it's a submenu or not
        if (dbusItem.property_get("children-display") == "submenu")
            var shellItem = new PopupMenu.PopupSubMenuMenuItem("FIXME")
        else if (dbusItem.property_get("type") == "separator")
            var shellItem = new PopupMenu.PopupSeparatorMenuItem('')
        else
            var shellItem = new PopupMenu.PopupMenuItem("FIXME")

        shellItem._dbusItem = dbusItem
        shellItem._dbusClient = client

        if (shellItem instanceof PopupMenu.PopupMenuItem) {
            shellItem._icon = new St.Icon({ style_class: 'popup-menu-icon', x_align: St.Align.END })
            shellItem.actor.add(shellItem._icon, { x_align: St.Align.END })
            shellItem.label.get_parent().child_set(shellItem.label, { expand: true })
        }

        // initialize our state
        MenuItemFactory._updateLabel.call(shellItem)
        MenuItemFactory._updateOrnament.call(shellItem)
        MenuItemFactory._updateImage.call(shellItem)
        MenuItemFactory._updateVisible.call(shellItem)
        MenuItemFactory._updateSensitive.call(shellItem)

        // initially create children
        if (shellItem instanceof PopupMenu.PopupSubMenuMenuItem) {
            let children = dbusItem.get_children()
            for (let i = 0; i < children.length; ++i) {
                shellItem.menu.addMenuItem(MenuItemFactory.createItem(client, children[i]))
            }
        }

        // now, connect various events
        Util.connectSmart(dbusItem, 'property-changed', shellItem, MenuItemFactory._onPropertyChanged)
        Util.connectSmart(dbusItem, 'child-added',      shellItem, MenuItemFactory._onChildAdded)
        Util.connectSmart(dbusItem, 'child-removed',    shellItem, MenuItemFactory._onChildRemoved)
        Util.connectSmart(dbusItem, 'child-moved',      shellItem, MenuItemFactory._onChildMoved)
        Util.connectSmart(shellItem, 'activate',        shellItem, MenuItemFactory._onActivate)

        if (shellItem.menu)
            Util.connectSmart(shellItem.menu, "open-state-changed", shellItem,  MenuItemFactory._onOpenStateChanged)

        return shellItem
    },

    _onOpenStateChanged: function(menu, open) {
        if (open) {
            if (NEED_NESTED_SUBMENU_FIX) {
                // close our own submenus
                if (menu._openedSubMenu)
                    menu._openedSubMenu.close(false)

                // register ourselves and close sibling submenus
                if (menu._parent._openedSubMenu && menu._parent._openedSubMenu !== menu)
                    menu._parent._openedSubMenu.close(true)

                menu._parent._openedSubMenu = menu
            }

            this._dbusItem.handle_event("opened", null, 0)
            this._dbusItem.send_about_to_show()
        } else {
            if (NEED_NESTED_SUBMENU_FIX) {
                // close our own submenus
                if (menu._openedSubMenu)
                    menu._openedSubMenu.close(false)
            }

            this._dbusItem.handle_event("closed", null, 0)
        }
    },

    _onActivate: function() {
        this._dbusItem.handle_event("clicked", GLib.Variant.new("i", 0), 0)
    },

    _onPropertyChanged: function(dbusItem, prop, value) {
        if (prop == "toggle-type" || prop == "toggle-state")
            MenuItemFactory._updateOrnament.call(this)
        else if (prop == "label")
            MenuItemFactory._updateLabel.call(this)
        else if (prop == "enabled")
            MenuItemFactory._updateSensitive.call(this)
        else if (prop == "visible")
            MenuItemFactory._updateVisible.call(this)
        else if (prop == "icon-name" || prop == "icon-data")
            MenuItemFactory._updateImage.call(this)
        else if (prop == "type" || prop == "children-display")
            MenuItemFactory._replaceSelf.call(this)
        //else
        //    Util.Logger.debug("Unhandled property change: "+prop)
    },

    _onChildAdded: function(dbusItem, child, position) {
        if (!(this instanceof PopupMenu.PopupSubMenuMenuItem)) {
            Util.Logger.warn("Tried to add a child to non-submenu item. Better recreate it as whole")
            MenuItemFactory._replaceSelf.call(this)
        } else {
            this.menu.addMenuItem(MenuItemFactory.createItem(this._dbusClient, child), position)
        }
    },

    _onChildRemoved: function(dbusItem, child) {
        if (!(this instanceof PopupMenu.PopupSubMenuMenuItem)) {
            Util.Logger.warn("Tried to remove a child from non-submenu item. Better recreate it as whole")
            MenuItemFactory._replaceSelf.call(this)
        } else {
            // find it!
            this.menu._getMenuItems().forEach(function(item) {
                if (item._dbusItem == child)
                    item.destroy()
            })
        }
    },

    _onChildMoved: function(dbusItem, child, oldpos, newpos) {
        if (!(this instanceof PopupMenu.PopupSubMenuMenuItem)) {
            Util.Logger.warn("Tried to move a child in non-submenu item. Better recreate it as whole")
            MenuItemFactory._replaceSelf.call(this)
        } else {
            MenuUtils.moveItemInMenu(this.menu, child, newpos)
        }
    },

    _updateLabel: function() {
        let label = this._dbusItem.property_get("label").replace(/_([^_])/, "$1")

        if (this.label) // especially on GS3.8, the separator item might not even have a hidden label
            this.label.set_text(label)
    },

    _updateOrnament: function() {
        if (!this.setOrnament) return // separators and alike might not have gotten the polyfill

        if (this._dbusItem.property_get("toggle-type") == "checkmark" && this._dbusItem.property_get_int("toggle-state"))
            this.setOrnament(PopupMenu.Ornament.CHECK)
        else if (this._dbusItem.property_get("toggle-type") == "radio" && this._dbusItem.property_get_int("toggle-state"))
            this.setOrnament(PopupMenu.Ornament.DOT)
        else
            this.setOrnament(PopupMenu.Ornament.NONE)
    },

    _updateImage: function() {
        if (!this._icon) return // might be missing on submenus / separators

        let iconName = this._dbusItem.property_get("icon-name")
        let iconData = this._dbusItem.property_get_variant("icon-data")
        if (iconName)
            this._icon.icon_name = iconName
        else if (iconData)
            this._icon.gicon = GdkPixbuf.Pixbuf.new_from_stream(Gio.MemoryInputStream.new_from_bytes(iconData.get_data_as_bytes()), null)
    },

    _updateVisible: function() {
        this.actor.visible = this._dbusItem.property_get_bool("visible")
    },

    _updateSensitive: function() {
        this.setSensitive(this._dbusItem.property_get_bool("enabled"))
    },

    _replaceSelf: function(newSelf) {
        // create our new self if needed
        if (!newSelf)
            newSelf = MenuItemFactory.createItem(this._dbusClient, this._dbusItem)

        // first, we need to find our old position
        let pos = -1
        let family = this._parent._getMenuItems()
        for (let i = 0; i < family.length; ++i) {
            if (family[i] === this)
                pos = i
        }

        if (pos < 0)
            throw new Error("DBusMenu: can't replace non existing menu item")


        // add our new self while we're still alive
        this._parent.addMenuItem(newSelf, pos)

        // now destroy our old self
        this.destroy()
    }
}

/**
 * Utility functions not necessarily belonging into the item factory
 */
const MenuUtils = {
    moveItemInMenu: function(menu, dbusItem, newpos) {
        //HACK: we're really getting into the internals of the PopupMenu implementation

        // First, find our wrapper. Children tend to lie. We do not trust the old positioning.
        let family = menu._getMenuItems()
        for (let i = 0; i < family.length; ++i) {
            if (family[i]._dbusItem == dbusItem) {
                // now, remove it
                menu.box.remove_child(family[i].actor)

                // and add it again somewhere else
                if (newpos < family.length && family[newpos] != family[i])
                    menu.box.insert_child_below(family[i].actor, family[newpos].actor)
                else
                    menu.box.add(family[i].actor)

                // skip the rest
                return
            }
        }
    }
}


/**
 * Processes DBus events, creates the menu items and handles the actions
 *
 * Something like a mini-god-object
 */
const Client = new Lang.Class({
    Name: 'DbusMenuClient',

    _init: function(busName, path) {
        this.parent()
        this._busName  = busName
        this._busPath  = path
        this._client   = new DBusClient(busName, path)
        this._rootMenu = null // the shell menu
        this._rootItem = null // the DbusMenuItem for the root
    },

    // this will attach the client to an already existing menu that will be used as the root menu.
    // it will also connect the client to be automatically destroyed when the menu dies.
    attachToMenu: function(menu) {
        this._rootMenu = menu
        this._rootItem = this._client.get_root()

        // cleanup: remove existing children (just in case)
        this._rootMenu.removeAll()

        if (NEED_NESTED_SUBMENU_FIX)
            menu._setOpenedSubMenu = this._setOpenedSubmenu.bind(this)

        // connect handlers
        Util.connectSmart(menu, 'open-state-changed', this, '_onMenuOpened')
        Util.connectSmart(menu, 'destroy',            this, 'destroy')

        Util.connectSmart(this._rootItem, 'child-added',   this, '_onRootChildAdded')
        Util.connectSmart(this._rootItem, 'child-removed', this, '_onRootChildRemoved')
        Util.connectSmart(this._rootItem, 'child-moved',   this, '_onRootChildMoved')

        // Dropbox requires us to call AboutToShow(0) first
        this._rootItem.send_about_to_show()

        // fill the menu for the first time
        this._rootItem.get_children().forEach(function(child) {
            this._rootMenu.addMenuItem(MenuItemFactory.createItem(this, child))
        }, this)
    },

    _setOpenedSubmenu: function(submenu) {
        if (!submenu)
            return

        if (submenu._parent != this._rootMenu)
            return

        if (submenu === this._openedSubMenu)
            return

        if (this._openedSubMenu && this._openedSubMenu.isOpen)
            this._openedSubMenu.close(true)

        this._openedSubMenu = submenu
    },

    _onRootChildAdded: function(dbusItem, child, position) {
        this._rootMenu.addMenuItem(MenuItemFactory.createItem(this, child), position)
    },

    _onRootChildRemoved: function(dbusItem, child) {
        // children like to play hide and seek
        // but we know how to find it for sure!
        this._rootMenu._getMenuItems().forEach(function(item) {
            if (item._dbusItem == child)
                item.destroy()
        })
    },

    _onRootChildMoved: function(dbusItem, child, oldpos, newpos) {
        MenuUtils.moveItemInMenu(this._rootMenu, dbusItem, newpos)
    },

    _onMenuOpened: function(menu, state) {
        if (!this._rootItem) return

        if (state) {
            if (this._openedSubMenu && this._openedSubMenu.isOpen)
                this._openedSubMenu.close()

            this._rootItem.handle_event("opened", null, 0)
            this._rootItem.send_about_to_show()
        } else {
            this._rootItem.handle_event("closed", null, 0)
        }
    },

    destroy: function() {
        this.emit('destroy')

        if (this._client)
            this._client.destroy()

        this._client   = null
        this._rootItem = null
        this._rootMenu = null
    }
})
Signals.addSignalMethods(Client.prototype)
