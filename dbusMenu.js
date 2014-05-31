/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
// Copyright (C) 2011 Giovanni Campagna
// Copyright (C) 2013 Jonas Kuemmerlin <rgcjonas@gmail.com>
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

const Lang = imports.lang
const Gio = imports.gi.Gio
const GLib = imports.gi.GLib
const Atk = imports.gi.Atk
const St = imports.gi.St
const Signals = imports.signals

const PopupMenu = imports.ui.popupMenu
const Shell = imports.gi.Shell

const Extension = imports.misc.extensionUtils.getCurrentExtension()
const Util = Extension.imports.util
const Interfaces = Extension.imports.interfaces
const Q = Extension.imports.q.Q

Q.longStackSupport = true;

const DBusMenuProxy = Gio.DBusProxy.makeProxyWrapper(Interfaces.DBusMenu)


/**
 * Common mixin for DbusPopupMenu and DbusSubMenu
 *
 * Contains the layout builder and fires back events to the client
 */
const DBusMenuMixin = new Lang.Class({
    Name: 'DBusMenuMixin',
    Extends: Util.Mixin,

    _init: function(client) {
        this.parent()
        this._mixin._client = client
    },

    _mixin: {
        // refills the menu from the given layout (as read from dbus)
        // returns a promise
        refillFromLayout: function(root) {
            let id = root[0]
            let children = root[2]

            this._busId = id

            if (children.length == 0) {
                return Q(null)
            } else {
                let childrenLoadPromises = children.map(function(variant) {
                    let child = variant.deep_unpack()
                    let id = child[0]
                    return this._client.menuItemFactory.createItem(id, child)
                }.bind(this))

                // wait for everything to be loaded, then replace everything
                return Q.all(childrenLoadPromises)
                    .then(this.replaceAllItems.bind(this))
            }
        },

        replaceAllItems: function(items) {
            this.removeAll()
            for each(let item in items) {
                this.addMenuItem(item)
                this._client.cache(item._busId, item) // add to cache
                item._parentMenu = this
            }
        },

        replaceSingleItem: function(old_item, new_item) {
            // find the position
            let items = this._getMenuItems()
            let index = -1
            for (let i = 0; i < items.length; ++i) {
                if (items[i] == old_item) {
                    index = i
                    break
                }
            }
            if (index > -1) {
                old_item.destroy()
                this.addMenuItem(new_item, index)
                this._client.cache(new_item._busId, new_item) // add to cache
                new_item._parentMenu = this
            } else {
                throw new Error("DBusMenu: trying to replace item that is not in list")
            }
        }
    }
})

/**
 * Creates menu items from layout and properties.
 * Will automatically retrieve missing info from the Client.
 *
 * Created menu items should be treated immutable.
 */
const DBusMenuItemFactory = new Lang.Class({
    Name: 'DBusMenuItemFactory',

    _init: function(client) {
        this._client = client
    },

    // only public method
    // async, returns promise
    createItem: Q.async(function(id, layout) {
        if (!layout)
            layout = yield this._client.getLayout(id, [])

        let props = this._client.decodeProperties(layout[1])
        let children = layout[2]
        let item = null

        // label is needed most of the time
        let label = props["label"] || ''
        if (label) // get rid of underscores
            label = label.replace(/_([^_])/, '$1')

        if (children && children.length) {
            // children? let's create a submenu
            item = yield this._createSubMenuItem(id, label, children)
        } else if (props.type == 'separator') {
            // separators are special, too
            item = new PopupMenu.PopupSeparatorMenuItem()
        } else {
            // a "normal" item with label, icons

            if (props["toggle-type"] && props["toggle-type"] != "none") {
                // toggle items may be special
                item = this._createToggle(label, props)
            } else {
                // a really normal item
                item = new PopupMenu.PopupMenuItem(label)
            }

            // maybe add an icon
            let icon_name = props["icon-name"]
            let icon_data = props["icon-data"]
            if (icon_data || icon_name) {
                let iconActor;
                if (icon_data)
                    iconActor = Util.createActorFromMemoryImage(icon_data, 24)
                else if (icon_name)
                    iconActor = new St.Icon({ "icon-name": icon_name })

                iconActor.add_style_class_name('popup-menu-icon')
                if (item.addActor) { // GS 3.8
                    item.addActor(iconActor, { align: St.Align.END })
                } else { // 3.10
                    item.label.set_x_expand(true)
                    item.actor.add(iconActor, { align: St.Align.END })
                }
            }

            // set reativeness
            if ("enabled" in props && !props["enabled"]) // not enabled
                item.setSensitive(false)
        }

        // do we need to hide it?
        if ("visible" in props && !props["visible"])
            item.actor.hide()

        // save the id for later
        item._busId = id

        // register our activate handler
        let activateHandlerId = item.connect("activate", this._client.itemActivated.bind(this._client, id))

        // uncache it at destroy
        let destroyHandlerId = item.connect("destroy", function() {
            item.disconnect(activateHandlerId)
            item.disconnect(destroyHandlerId)
            this._client.uncache(id)
        }.bind(this))

        Q.return(item)
    }),

    _createSubMenuItem: Q.async(function(id, label, children) {
        let item = new PopupMenu.PopupSubMenuMenuItem(label)

        new DBusMenuMixin(this._client).attach(item.menu)

        yield item.menu.refillFromLayout([id, null, children])

        Q.return(item)
    }),

    _createToggle: function(label, props) {
        let toggle_type = props["toggle-type"]
        let toggle_state = props["toggle-state"]

        let item = null

        if (PopupMenu.PopupMenuItem.prototype.setShowDot) {
            // GS 3.8: implement toggles using setShowDot and switches
            if (toggle_type == "radio") {
                item = new PopupMenu.PopupMenuItem(label)
                item.setShowDot(toggle_state)
            } else { // must be checkbox
                item = new PopupMenu.PopupSwitchMenuItem(label, toggle_state)
            }
        } else { // GS 3.10: implement toggles using Ornaments
            item = new PopupMenu.PopupMenuItem(label)

            if (toggle_type == "radio" && toggle_state)
                item.setOrnament(PopupMenu.Ornament.DOT)
            else if (toggle_state) // checkbox is implied
                item.setOrnament(PopupMenu.Ornament.CHECK)
        }

        item.actor.accessible_role = Atk.Role.CHECK_MENU_ITEM

        return item
    }
})

/**
 * Processes DBus events, creates the menu items and handles the actions
 *
 * Something like a mini-god-object
 */
const Client = new Lang.Class({
    Name: 'DbusMenuClient',

    _init: function(busConn, busName, path) {
        this.parent()
        this._busConn = busConn
        this._busName = busName
        this._path = path

        // Hash table (id:menuItem)
        this._menuItemCache = {}

        // the item factory
        this._menuItemFactory = new DBusMenuItemFactory(this)
    },

    get menuItemFactory() {
        return this._menuItemFactory
    },

    // you must call this before real work is being done
    // if you provide a callback, it will be called when the menu has been built completely
    //
    // this must be called after "init" succeeded
    attachToMenu: function(menu, callback) {
        this._rootMenu = menu
        new DBusMenuMixin(this).attach(menu)

        // I will queue all layout operations I will queue all layout operations I will queue....
        this._queueLayoutOperation(function(callback) {
            // get layout for root node
            this._rebuildMenuWithLayout(0).finally(callback)
        }.bind(this), callback)

        let openHandlerId = menu.connect("open-state-changed", this.menuOpened.bind(this))

        menu.connect("destroy", function() {
            menu.disconnect(openHandlerId)
        }.bind(this))
    },

    // dbus handling
    init: function(callback) {
        this._proxy = new DBusMenuProxy(this._busConn, this._busName, this._path, function(result, error) {
            if (error) {
                callback(error)
                return;
            }

            this._proxy.connectSignal('ItemsPropertiesUpdated', Lang.bind(this, this._itemsPropertiesUpdated))

            this._revision = 0;

            this._readLayoutQueue = new Util.AsyncTaskQueue()

            callback()
        }.bind(this))
    },

    // turns the a{sv} property dictionary into a javascript object
    // includes the special handling for the "icon-data" array
    decodeProperties: function(properties) {
        if (properties instanceof GLib.Variant)
            properties = properties.deep_unpack()

        let decodedProperties = {}

        for (var i in properties) {
            if (i == 'icon-data') {
                //HACK: newer gjs can transform byte arrays in GBytes automatically, but the versions
                //      commonly found bundled with GS 3.6 (Ubuntu 12.10, 13.04) don't do that :(
                decodedProperties[i] = Util.variantToGBytes(properties[i])
            } else {
                decodedProperties[i] = properties[i].deep_unpack()
            }
        }

        return decodedProperties;
    },

    // returns a promise
    getPropertiesForId: function(id, properties) {
        let deferred = Q.defer()

        this._proxy.GetGroupPropertiesRemote([id], properties, function(result, error) {
            if (error) {
                deferred.reject(error)
            } else {
                if (!result[0][0]) {
                    //FIXME: how the hell does nm-applet manage to get us here?
                    //it doesn't seem to have any negative effects, however
                    Util.Logger.debug("While reading item "+id+" on "+this.busName+this.path+": ")
                    Util.Logger.debug("Empty result set (?)")
                    Util.Logger.debug(result)

                    // resolve with empty set
                    deferred.resolve({})
                } else {
                    // do some massaging on the result
                    //FIXME: this doesn't just look weird. It is weird.
                    let props = result[0][0][1]

                    deferred.resolve(this.decodeProperties(props))
                }
            }
        }.bind(this))

        return deferred.promise
    },

    // operating on the menu structure might intefere if someone attempts to do it in parallel
    // we need to serialize everything
    _queueLayoutOperation: function(task, callback) {
        this._readLayoutQueue.add(task, callback)
    },

    // rebuilds the menu at the given id with the given layout
    // you may pass in a falsy value for the layout, and it will be retrieved.
    // returns a promise
    _rebuildMenuWithLayout: function(id, layout) {
        // we have a direct reference to the root menu
        if (id == 0) {
            let layoutPromise; // we might not have the layout, so we make sure to get it
            if (layout) layoutPromise = Q(layout)
            else layoutPromise = this.getLayout(id, [])

            return layoutPromise.then(function(layout) {
                return this._rootMenu.refillFromLayout(layout)
            }.bind(this))
        } else {
            // we may have it in the cache
            let item = this.lookup(id)
            if (item) {
                return this.menuItemFactory.createItem(id, layout).then(function(newItem) {
                    item._parentMenu.replaceSingleItem(item, newItem)
                })
            } else {
                Util.Logger.warn("DBusMenu reading layout for item that does not exist?")
                Util.Logger.warn("Deliberately ignoring it, but beware the menu might be corrupted")
                //FIXME: should we initiate a complete rebuild here?
                return Q(true)
            }
        }
    },

    // async, returns a promise
    getLayout: function(id, properties) {
        let deferred = Q.defer()

        if (typeof properties == "undefined")
            properties = ['id']

        //(RANT) Who at Gnome HQ thought it was a good idea to make a callback (result, error)
        // when everyone else settled on (error, result)? Now we can't use nice promise
        // adapters because a gnome dev decided he must put the parameters the other way round
        this._proxy.GetLayoutRemote(id, -1, properties, function(result, error) {
            if (error) {
                deferred.reject(error)
            } else {
                let revision = result[0]
                let root = result[1]

                // better check whether revision is sane
                if ("_revision" in this && revision < this._revision) {
                    // Has been seen in skype
                    Util.Logger.debug("DBusMenu: trying to replace with older layout ?!")
                    Util.Logger.debug("For id "+id+" got layout "+revision+" having already seen revision "+this._revision)
                    deferred.reject(new Error("Older layout received, something is fishy here."))
                } else {
                    this._revision = revision

                    deferred.resolve(root)
                }
            }
        }.bind(this))

        return deferred.promise
    },

    // puts a menu item in the cache
    cache: function(id, item) {
        this._menuItemCache[id] = item
    },

    // removes a menu item from the cache
    uncache: function(id) {
        delete this._menuItemCache[id]
    },

    // searches a item in the cache
    lookup: function(id) {
        if (id in this._menuItemCache) return this._menuItemCache[id]
        else return null
    },

    // send event about opening/closing submenu
    menuOpened: function(menu, state) {
        // we send an AboutToShow event and maybe update the layout
        let id = menu._busId || 0

        this._proxy.AboutToShowRemote(id, function(result, error) {
            if (error) {
                throw error // js runtime will pick it up and display to the dev
            } else {
                if (result) {
                    this._queueLayoutOperation(function(callback) {
                        this._rebuildMenuWithLayout(id).finally(callback)
                    }.bind(this))
                }
            }
        }.bind(this))
    },

    // send "clicked" event over the bus
    itemActivated: function(id, item, event) {
        // we emit clicked also for keyboard activation
        // XXX: what is event specific data?
        this._proxy.EventRemote(id, 'clicked', GLib.Variant.new("s", ""), event.get_time())
    },

    _itemsPropertiesUpdated: function (proxy, bus, [changed, removed]) {
        // assemble a list of all ids that need to be regenerated
        let idHash = {} //HACK: will eat any duplicate ids
        for each(let i in changed.concat(removed)) {
            idHash[i[0]] = true
        }
        let idList = Object.keys(idHash)

        this._queueLayoutOperation(function(callback) {
            Q.all(idList.map(function(id) { return this._rebuildMenuWithLayout(id) }, this)).finally(callback)
        }.bind(this))
    },

    _layoutUpdated: function(proxy, bus, [revision, subtreeId]) {
        if ("_revision" in this && revision < this._revision) {
            Util.Logger.warn("DBusMenu: Trying to update with layout that is older than the one we have")
            Util.Logger.warn("Something is corrupt here.")
            return
        } else {
            this._revision = revision
        }

        // We need to enqueue layout work because modifying the menu in parallel usually goes terribly wrong
        this._queueLayoutOperation(function(callback) {
            this._rebuildMenuWithLayout(subtreeId).finally(callback)
        }.bind(this))

    }
})
