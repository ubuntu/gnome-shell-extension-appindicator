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
const Clutter = imports.gi.Clutter

const PopupMenu = imports.ui.popupMenu
const Shell = imports.gi.Shell

const Extension = imports.misc.extensionUtils.getCurrentExtension()
const Util = Extension.imports.util

/**
 * Creates new wrapper menu items and injects methods for managing them at runtime.
 *
 * Many functions in this object will be bound to the created item and executed as event
 * handlers, so any `this` will refer to a menu item create in createItem
 */
const MenuItemFactory = {
    // Ornament polyfill for 3.8
    OrnamentType: PopupMenu.Ornament ? PopupMenu.Ornament : {
        NONE: 0,
        CHECK: 1,
        DOT: 2
    },

    _setOrnamentPolyfill: function(ornamentType) {
        if (ornamentType == MenuItemFactory.OrnamentType.CHECK) {
            this._ornament.set_text('\u2713')
            this.actor.add_accessible_state(Atk.StateType.CHECKED)
        } else if (ornamentType == MenuItemFactory.OrnamentType.DOT) {
            this._ornament.set_text('\u2022')
            this.actor.add_accessible_state(Atk.StateType.CHECKED)
        } else {
            this._ornament.set_text('')
            this.actor.remove_accessible_state(Atk.StateType.CHECKED)
        }
    },

    // GS3.8 uses a complicated system to compute the allocation for each child in pure JS
    // we hack together a function that allocates space for our ornament, using the x
    // calculations normally used for the dot and the y calculations used for every
    // other item. Thank god they replaced that whole allocation stuff in 3.10, so I don't
    // really need to understand how it works, as long as it looks right in 3.8
    _allocateOrnament: function(actor, box, flags) {
        if (!this._ornament) return

        let height = box.y2 - box.y1;
        let direction = actor.get_text_direction();

        let dotBox = new Clutter.ActorBox()
        let dotWidth = Math.round(box.x1 / 2)

        if (direction == Clutter.TextDirection.LTR) {
            dotBox.x1 = Math.round(box.x1 / 4)
            dotBox.x2 = dotBox.x1 + dotWidth
        } else {
            dotBox.x2 = box.x2 + 3 * Math.round(box.x1 / 4)
            dotBox.x1 = dotBox.x2 - dotWidth
        }

        let [minHeight, naturalHeight] = this._ornament.get_preferred_height(dotBox.x2 - dotBox.x1)

        dotBox.y1 = Math.round(box.y1 + (height - naturalHeight) / 2)
        dotBox.y2 = dotBox.y1 + naturalHeight

        this._ornament.allocate(dotBox, flags)
    },

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
            if (shellItem.addActor) { //GS 3.8
                shellItem.addActor(shellItem._icon, { align: St.Align.END })
            } else { //GS >= 3.10
                shellItem.actor.add(shellItem._icon, { x_align: St.Align.END })
                shellItem.label.get_parent().child_set(shellItem.label, { expand: true })
            }

            // GS3.8: emulate the ornament stuff.
            // this is similar to how the setShowDot function works
            if (!shellItem.setOrnament) {
                shellItem._ornament = new St.Label()
                shellItem.actor.add_actor(shellItem._ornament)
                shellItem.setOrnament = MenuItemFactory._setOrnamentPolyfill
                shellItem.actor.connect('allocate', MenuItemFactory._allocateOrnament.bind(shellItem)) //GS doesn't disconnect that one, either
            }
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
        Util.connectAndRemoveOnDestroy(dbusItem, {
            'property-changed':   MenuItemFactory._onPropertyChanged.bind(shellItem),
            'child-added':        MenuItemFactory._onChildAdded.bind(shellItem),
            'child-removed':      MenuItemFactory._onChildRemoved.bind(shellItem),
            'child-moved':        MenuItemFactory._onChildMoved.bind(shellItem)
        }, shellItem)
        Util.connectAndRemoveOnDestroy(shellItem, {
            'activate':  MenuItemFactory._onActivate.bind(shellItem)
        })
        if (shellItem.menu)
            Util.connectAndRemoveOnDestroy(shellItem.menu, {
                "open-state-changed": MenuItemFactory._onOpenStateChanged.bind(shellItem)
            })

        return shellItem
    },

    _onOpenStateChanged: function(menu, open) {
        if (open) {
            this._dbusItem.handle_event("opened", GLib.Variant.new("i", 0), 0)
            this._dbusClient.ghettoAboutToShow(this._dbusItem.get_id())
        } else {
            this._dbusItem.handle_event("closed", GLib.Variant.new("i", 0), 0)
        }
    },

    _onActivate: function() {
        this._dbusItem.handle_event("clicked", GLib.Variant.new("i", 0), 0)
    },

    _onPropertyChanged: function(dbusItemm, prop, value) {
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
            //HACK: we're really getting into the internals of the PopupMenu implementation

            // First, find our wrapper. We do not trust the old positioning.
            let family = this.menu._getMenuItems()
            for (let i = 0; i < family.length; ++i) {
                if (family[i]._dbusItem == child) {
                    // now, remove it
                    this.menu.box.remove_child(family[i].actor)

                    // and add it again somewhere else
                    if (newpos < family.length && family[newpos] != family[i])
                        this.menu.box.insert_child_below(family[i].actor, family[newpos].actor)
                    else
                        this.menu.box.add(family[i].actor)

                    // skip the rest
                    return
                }
            }
        }
    },

    _updateLabel: function() {
        let label = this._dbusItem.property_get("label")

        if (label)
            label = label.replace(/_([^_])/, "$1") // get rid of underscores telling us the keyboard accelerators
        else
            label = ''

        if (this.label) // especially on GS3.8, the separator item might not even have a hidden label
            this.label.set_text(label)
    },

    _updateOrnament: function() {
        if (!this.setOrnament) return // separators and alike might not have gotten the polyfill

        if (this._dbusItem.property_get("toggle-type") == "checkmark" && this._dbusItem.property_get_int("toggle-state"))
            this.setOrnament(MenuItemFactory.OrnamentType.CHECK)
        else if (this._dbusItem.property_get("toggle-type") == "radio" && this._dbusItem.property_get_int("toggle-state"))
            this.setOrnament(MenuItemFactory.OrnamentType.DOT)
        else
            this.setOrnament(MenuItemFactory.OrnamentType.NONE)
    },

    _updateImage: function() {
        if (!this._icon) return // might be missing on submenus / separators

        let iconName = this._dbusItem.property_get("icon-name")
        let iconData = this._dbusItem.property_get_variant("icon-data")
        if (iconName)
            this._icon.icon_name = iconName
        else if (iconData)
            this._icon.gicon = Util.createPixbufFromMemoryImage(iconData.get_data_as_bytes())
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
        this._client   = 'Dbusmenu' in imports.gi ? imports.gi.Dbusmenu.Client.new(busName, path) : null
        this._rootMenu = null // the shell menu
        this._rootItem = null // the DbusMenuItem for the root

        this._rootItemDisconnectHandlers = []
        this._menuDisconnectHandlers     = []
        this._rootChangedHandler         = null
    },

    // this will attach the client to an already existing menu that will be used as the root menu.
    // it will also connect the client to be automatically destroyed when the menu dies.
    attachToMenu: function(menu) {
        this._rootMenu = menu

        // fallbak error message in case we don't have libdbusmenu
        if (!this._client) {
            let error = new PopupMenu.PopupMenuItem('ERROR: Could not load libdbusmenu')
            error.setSensitive(false)
            menu.addMenuItem(error)

            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem())

            //FIXME: can we be nice to non-ubuntu users, too?
            if (GLib.find_program_in_path('software-center')) {
                let advice = new PopupMenu.PopupMenuItem('Install gir1.2-dbusmenu-glib-0.4 now')
                Util.connectAndRemoveOnDestroy(advice, {
                    'activate': function() {
                        GLib.spawn_command_line_async('software-center gir1.2-dbusmenu-glib-0.4')
                    }
                })
                menu.addMenuItem(advice)
            } else {
                let advice = new PopupMenu.PopupMenuItem('Please install matching introspection data')
                advice.setSensitive(false)
                menu.addMenuItem(advice)
            }
        } else {
            this._rootChangedHandler = this._client.connect("root-changed", this._onRootChanged.bind(this))
            Util.connectAndSaveId(menu, {
                'open-state-changed': this._onMenuOpened.bind(this),
                'destroy'           : this.destroy.bind(this)
            }, this._menuDisconnectHandlers)

            this._onRootChanged()
        }
    },

    _onRootChanged: function() {
        // cleanup: remove handlers
        if (this._rootItem)
            Util.disconnectArray(this._rootItemDisconnectHandlers)

        // cleanup: remove existing wrapper childs
        this._rootMenu.removeAll()

        // save new root
        this._rootItem = this._client.get_root()

        if (this._rootItem) {
            // connect new handlers
            Util.connectAndSaveId(this._rootItem, {
                "child-added"   : this._onRootChildAdded.bind(this),
                "child-removed" : this._onRootChildRemoved.bind(this),
                "child-moved"   : this._onRootChildMoved.bind(this)
            }, this._rootItemDisconnectHandlers)

            // fill the menu for the first time
            for each(let child in this._rootItem.get_children())
                this._rootMenu.addMenuItem(MenuItemFactory.createItem(this, child))
        }
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
        //HACK: we're really getting into the internals of the PopupMenu implementation

        // First, find our wrapper. Children tend to lie. We do not trust the old positioning.
        let family = this._rootMenu._getMenuItems()
        for (let i = 0; i < family.length; ++i) {
            if (family[i]._dbusItem == child) {
                // now, remove it
                this._rootMenu.box.remove_child(family[i].actor)

                // and add it again somewhere else
                if (newpos < family.length && family[newpos] != family[i])
                    this._rootMenu.box.insert_child_below(family[i].actor, family[newpos].actor)
                else
                    this._rootMenu.box.add(family[i].actor)

                // skip the rest
                return
            }
        }
    },

    _onMenuOpened: function(menu, state) {
        if (!this._rootItem) return

        if (state) {
            this._rootItem.handle_event("opened", GLib.Variant.new("i", 0), 0)
            this.ghettoAboutToShow(0)
        } else {
            this._rootItem.handle_event("closed", GLib.Variant.new("i", 0), 0)
        }
    },

    destroy: function() {
        if (this._rootMenu)
            Util.disconnectArray(this._rootMenu, this._menuDisconnectHandlers)

        if (this._rootItem)
            Util.disconnectArray(this._rootItem, this._rootItemDisconnectHandlers)

        if (this._client)
            this._client.disconnect(this._rootChangedHandler)

        // we set them to null in case the client instance lingers around
        // while the dbus menu could already be garbage collected
        this._client   = null
        this._rootItem = null
        this._rootMenu = null
    },

    //HACK: when calling DbusmenuMenuitem::send_about_to_show, gjs will complain that
    // the argument 'cb' (type void) may not be null, and request 2 arguments.
    // this is wrong on multiple levels and clearly a bug in the introspection data or
    // gjs mapping, which I could not track down as of now. We'll work around that by
    // issuing the about to show event via raw dbus calls ourselves.
    ghettoAboutToShow: function(id) {
        Gio.DBus.session.call(this._busName,
                              this._busPath,
                              "com.canonical.dbusmenu",
                              "AboutToShow",
                              GLib.Variant.new("(i)", [id]),
                              GLib.VariantType.new("(b)"),
                              Gio.DBusCallFlags.NONE,
                              -1,
                              null,
                              function(conn, result) { /* we don't care about the result */ conn.call_finish(result) });
    }
})
