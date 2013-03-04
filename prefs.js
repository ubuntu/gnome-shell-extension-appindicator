/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
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

const Lang = imports.lang;
const Signals = imports.signals;
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Extension.imports.convenience;
const Gtk = imports.gi.Gtk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const _ = imports.gettext.domain(Extension.metadata['gettext-domain']).gettext;
const Settings = Extension.imports.settings.Settings;

var log = function() {
	print(Array.prototype.join.call(arguments, ","));
}

function init() {
	Convenience.initTranslations();
}

function buildPrefsWidget() {
    var widget = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL, margin: 10, expand: true });
    var default_box = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
    default_box.add(new Gtk.Label({ label: _("Default placement for indicator icons: ")}));
    var default_switch = new Gtk.ComboBoxText();
    default_switch.append("message-tray", _("Show in message tray"));
    default_switch.append("panel", _("Show in panel"));
    default_switch.append("blacklist", _("Do not show"));
    default_switch.connect("changed", Lang.bind(default_switch, defaultChangedCallback));
    default_switch.set_active_id(Settings.instance.getDefault());
    default_box.add(default_switch);
    widget.pack_start(default_box, false, false, 10);
    var overrides_frame = new Gtk.Frame({ label: _("Application specific settings")})
    var overrides_scroll = new Gtk.ScrolledWindow(); //jsut in case our list gets _really_ big...
    var overrides_table = new Gtk.Grid({ margin: 10 });
    populateGrid.apply(overrides_table);
    overrides_frame.add(overrides_scroll);
    overrides_scroll.add_with_viewport(overrides_table);
    widget.pack_start(overrides_frame, true, true, 10);
    widget.show_all();
    
    Settings.instance.connect("changed", Lang.bind(overrides_table, populateGrid));
    listenForChangedActives(Lang.bind(overrides_table, populateGrid));
    
    return widget;
}

function populateGrid() {
	var grid = this;
	getActives(function(actives) {
    	var overrides = cloneObject(Settings.instance.getOverrides());
    	grid.foreach(Lang.bind(grid, Gtk.Grid.prototype.remove));
    	actives.forEach(function(e){
    		if (!(e in overrides)) {
    			overrides[e] = "auto";
    		}
    	});
    	var override_keys = Object.keys(overrides).sort(function(a, b){
    		var c = a.toLowerCase();
    		var d = b.toLowerCase();
    		return ((c < d) ? -1 : ((c > d) ? 1 : 0));
    	});
    	override_keys.forEach(function(e, i){
    		attachToGrid(grid, e, i, overrides[e], Lang.bind(null, overrideChangedCallback, e));	
    	});
    	grid.show_all();
    })
}

function defaultChangedCallback() {
	log("changed default to: "+this.get_active_id());
	Settings.instance.setDefault(this.get_active_id());
}

function overrideChangedCallback(select, name) {
	log("changed '"+name+"' to: "+select.get_active_id());
	Settings.instance.set(name, select.get_active_id());
}

function attachToGrid(grid, name, index, value, changedClb) {
	grid.attach(new Gtk.Label({label: name, xalign: 0, 'margin-right': 10 }), 0, index, 1, 1);
    var select = new Gtk.ComboBoxText();
    select.append("auto", _("Show at default location"));
    select.append("message-tray", _("Show in message tray"));
    select.append("panel", _("Show in panel"));
    select.append("blacklist", _("Do not show"));
    select.set_active_id(value);
    select.connect("changed", changedClb);
    grid.attach(select, 1, index, 1, 1);
}

//of course it would be easier to access our own internal data structures but this piece of codes works even in unity
function getActives(clb) {
	var wait_for_items_count;
	var results = [];
			
	Gio.DBus.session.call(
		"org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher", "org.freedesktop.DBus.Properties",
		"Get", GLib.Variant.new("(ss)", ["org.kde.StatusNotifierWatcher", "RegisteredStatusNotifierItems"]), 
		GLib.VariantType.new("(v)"), Gio.DBusCallFlags.NONE, -1, null, function(conn, result) {
			var items = conn.call_finish(result);
			items = items.deep_unpack()[0].deep_unpack();
			wait_for_items_count = items.length;
			items.forEach(function(e) {
				//split in bus name and path
				var bus = e.substr(0, e.indexOf("/"));
				var path = e.substr(e.indexOf("/"));
				//get the id property
				Gio.DBus.session.call(
					bus, path, "org.freedesktop.DBus.Properties", "Get", 
					GLib.Variant.new("(ss)", ["org.kde.StatusNotifierItem", "Id"]), GLib.VariantType.new("(v)"),
					Gio.DBusCallFlags.NONE, -1, null, function(conn, result) {
						var id = conn.call_finish(result);
						id = id.deep_unpack()[0].deep_unpack();
						results.push(id);
						if (--wait_for_items_count == 0) {
							clb(results);
						}
					}, null
				);
			})
		}, null
	);
}

function listenForChangedActives(clb) {
	Gio.DBus.session.signal_subscribe(
		"org.kde.StatusNotifierWatcher", "org.freedesktop.DBus.Properties", "PropertiesChanged", "/StatusNotifierWatcher",
		"org.kde.StatusNotifierWatcher", 0, function(conn, sender, path, iface, signal, params) {
			var [ , changed, invalidated ] = params.deep_unpack();
			if ("RegisteredStatusNotifierItems" in changed || invalidated.indexOf("RegisteredStatusNotifierItems") > -1) {
				clb();
			}
		}, null
	);
}

function cloneObject(obj) {
    var copy = {};
    for (var attr in obj) {
        if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
    }
    return copy;
}