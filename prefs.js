// Copyright (C) 2013-2014 Jonas Kümmerlin <rgcjonas@gmail.com>
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

// basic gjs stuff
const Lang = imports.lang;
const Signals = imports.signals;

// ourselves
const Extension = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Extension.imports.convenience;
const Config = Extension.imports.config;
const Settings = Extension.imports.settings.Settings;
const Interfaces = Extension.imports.interfaces;
const Util = Extension.imports.util;

// Shell and GI stuff
const ShellConfig = imports.misc.config;
const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

// gettext setup
const _ = imports.gettext.domain(Extension.metadata['gettext-domain']).gettext;

// dbus proxies
const StatusNotifierItemProxy = Gio.DBusProxy.makeProxyWrapper(Interfaces.StatusNotifierItem);
const StatusNotifierWatcherProxy = Gio.DBusProxy.makeProxyWrapper(Interfaces.StatusNotifierWatcher);

var log = function() {
    print(Array.prototype.join.call(arguments, ","));
}

function init() {
    Convenience.initTranslations();
}

function buildPrefsWidget() {
    var tabBar = new Gtk.Notebook();

    // placement settings tab
    tabBar.append_page(placementSettingsWidget(), Gtk.Label.new(_("Placement")));

    // about tab
    tabBar.append_page(aboutPage(), Gtk.Label.new(_("About")));

    tabBar.show_all();
    return tabBar;
}

// creates the "Placement" page
function placementSettingsWidget() {
    var widget = new Gtk.Box({orientation:Gtk.Orientation.VERTICAL, margin: 10, expand: true });
    var default_box = new Gtk.Box({orientation: Gtk.Orientation.HORIZONTAL, spacing: 10 });
    default_box.add(new Gtk.Label({ label: _("Default placement for indicator icons: ")}));
    var default_switch = new Gtk.ComboBoxText();
    default_switch.append("message-tray", _("Show in message tray"));
    default_switch.append("panel", _("Show in panel"));
    default_switch.append("dash", _("Show in dash (experimental)"));
    default_switch.append("blacklist", _("Do not show"));
    default_switch.connect("changed", Lang.bind(default_switch, defaultChangedCallback));
    default_switch.set_active_id(Settings.instance.getDefault());
    default_box.add(default_switch);
    widget.pack_start(default_box, false, false, 10);
    var overrides_frame = new Gtk.Frame({ label: _("Application specific settings")})
    var overrides_scroll = new Gtk.ScrolledWindow(); // just in case our list gets _really_ big...
    var overrides_table = new Gtk.Grid({ margin: 10 });

    populateGrid(overrides_table);

    overrides_frame.add(overrides_scroll);
    overrides_scroll.add_with_viewport(overrides_table);
    widget.pack_start(overrides_frame, true, true, 10);
    widget.show_all();

    Settings.instance.connect("changed", populateGrid.bind(null, overrides_table));
    listenForChangedActives(populateGrid.bind(null, overrides_table));

    return widget;
}

// creates the "About" page
function aboutPage() {
    var table = new Gtk.Grid({ margin: 10, 'row-spacing': 5, /*valign: Gtk.Align.CENTER,*/ halign: Gtk.Align.CENTER });

    var titleLbl = new Gtk.Label();
    titleLbl.set_markup("<span size='x-large' weight='bold'>"+_("AppIndicator support for Gnome Shell")+"</span>");

    var versionLbl = new Gtk.Label();
    versionLbl.set_markup("<span size='large' weight='light'>"+Config.version+"</span>");

    var copyrightLbl = new Gtk.Label();
    copyrightLbl.set_markup("Copyright (C) 2013-2014 <a href=\"mailto:rgcjonas@gmail.com\">Jonas Kümmerlin</a>");

    var specialThanksFrame = new Gtk.Frame({ label: _(" Special thanks ") });

    var specialPersons = {};
    specialPersons[_("<a href=\"https://bugzilla.gnome.org/show_bug.cgi?id=652122\">Initial patches</a>:")] = "<a href='mailto:scampa.giovanni@gmail.com'>Giovanni Campagna</a>";
    specialPersons[_("Dash placement:")] = "<a href=\"mailto:thomassc@ee.oulu.fi\">Thomas Schaberreiter</a>";
    specialPersons[_("Turkish translation:")] = "<a href=\"mailto:dkavraal@gmail.com\">Dincer Kavraal</a>";
    specialPersons[_("Spanish translation:")] = "<a href=\"mailto:damiannohales@gmail.com\">Damián Nohales</a>";
    specialPersons[_("Italian translation:")] = "<a href=\"mailto:david.dep.1996@gmail.com\">Davide Depau</a>";
    specialPersons[_("Polish translation:")] = "<a href=\"mailto:ozamorowski@gmail.com\">Oskar Zamorowski</a>";

    var specialPersonsGrid = new Gtk.Grid({ "row-spacing": 5, "column-spacing": 5, margin: 10 });
    {
        let i = 0;
        for (let role in specialPersons) {
            let roleLbl = new Gtk.Label();
            roleLbl.set_markup(role);
            roleLbl.xalign = 0;

            let personLbl = new Gtk.Label();
            personLbl.set_markup(specialPersons[role]);
            personLbl.xalign = 0;

            specialPersonsGrid.attach(roleLbl, 0, i, 1, 1);
            specialPersonsGrid.attach(personLbl, 1, i, 1, 1);

            ++i;
        }
    }

    specialThanksFrame.add(specialPersonsGrid);

    table.attach(titleLbl, 0, 0, 1, 1);
    table.attach(versionLbl, 0, 1, 1, 1);
    table.attach(copyrightLbl, 0, 2, 1, 1);
    table.attach(specialThanksFrame, 0, 3, 1, 1);

    var buttonsBox = new Gtk.Grid({ "column-homogeneous": true, "column-spacing": 5 });

    var homepageButton = Gtk.Button.new_with_label(_("Homepage"));
    homepageButton.connect("clicked", Gtk.show_uri.bind(null, null, "https://github.com/rgcjonas/gnome-shell-extension-appindicator", 0));
    homepageButton.tooltip_text = "https://github.com/rgcjonas/gnome-shell-extension-appindicator";
    var licenseButton = Gtk.Button.new_with_label(_("License"));
    licenseButton.connect("clicked", Gtk.show_uri.bind(null, null, "https://www.gnu.org/licenses/gpl-2.0.html", 0));
    licenseButton.tooltip_text = "GNU GPL v2.0 or later";
    var debugButton = Gtk.Button.new_with_label(_("Copy debug information"));
    debugButton.tooltip_text = _("Gather information useful for the developers and copies it to the clipboard.\nYou should include this when reporting bugs.");
    debugButton.connect("clicked", debugInfoToClipboard);

    buttonsBox.attach(homepageButton, 0, 0, 1, 1);
    buttonsBox.attach(licenseButton, 1, 0, 1, 1);
    buttonsBox.attach(debugButton, 2, 0, 1, 1);

    table.attach(buttonsBox, 0, 4, 1, 1);

    return table;

}

function populateGrid(grid) {
    var actives = getActivesSync();
    var overrides = cloneObject(Settings.instance.getOverrides());

    // clear grid
    grid.foreach(Lang.bind(grid, Gtk.Grid.prototype.remove));

    // fill missing overrides: overrides now contains values for every indicator
    actives.forEach(function(e){
        if (!(e in overrides)) {
            overrides[e] = "auto";
        }
    });

    // sort indicators
    var override_keys = Object.keys(overrides).sort(function(a, b){
        var c = a.toLowerCase();
        var d = b.toLowerCase();
        return ((c < d) ? -1 : ((c > d) ? 1 : 0));
    });

    // and put them into the grid
    override_keys.forEach(function(e, i){
        attachToGrid(grid, e, i, overrides[e], Lang.bind(null, overrideChangedCallback, e));
    });

    grid.show_all();
}

function defaultChangedCallback() {
    log("changed default to: "+this.get_active_id());
    Settings.instance.setDefault(this.get_active_id());
}

function overrideChangedCallback(select, name) {
    log("changed '"+name+"' to: "+select.get_active_id());
    Settings.instance.set(name, select.get_active_id());
}

// helper function: creates the ui for attaching an indicator to a grid
function attachToGrid(grid, name, index, value, changedClb) {
    grid.attach(new Gtk.Label({label: name, xalign: 0, 'margin-right': 10 }), 0, index, 1, 1);
    var select = new Gtk.ComboBoxText();
    select.append("auto", _("Show at default location"));
    select.append("message-tray", _("Show in message tray"));
    select.append("panel", _("Show in panel"));
    select.append("dash", _("Show in dash (experimental)"));
    select.append("blacklist", _("Do not show"));
    select.set_active_id(value);
    select.connect("changed", changedClb);
    grid.attach(select, 1, index, 1, 1);
}

// returns a StatusNotifierWatcher proxy that will be created if necessary
// HACK: is this the right way to hide a local static variable in javascript?
const getSNWProxy = (function(){
    var _proxy = null;
    return function() {
        if (_proxy === null) {
            _proxy = new StatusNotifierWatcherProxy(Gio.DBus.session, "org.kde.StatusNotifierWatcher", "/StatusNotifierWatcher");

            _proxy.connect("g-properties-changed", Util.refreshInvalidatedProperties);
        }
        return _proxy;
    }
})();

// of course it would be easier to access our own internal data structures but this piece of codes works even in unity
// FIXME: should/can we rewrite that to be async without creating callback hell
function getActivesSync() {
    // if we fail at some point down here, we can't do much more than emit a debug message and display nothing
    try {
        // create proxy for StatusNotifierWatcher
        var snwProxy = getSNWProxy();

        // get the list of ids
        var indicators = snwProxy.RegisteredStatusNotifierItems;

        // split it in bus name and path
        indicators = indicators.map(function(e) {
            return {
                bus: e.substr(0, e.indexOf("/")),
                path: e.substr(e.indexOf("/"))
            };
        });

        // get the "Id" attribute for every indicator
        indicators = indicators.map(function(i) {
            try {
                var proxy = new StatusNotifierItemProxy(Gio.DBus.session, i.bus, i.path);

                return proxy.Id;
            } catch (e) {
                log("Failed to retrieve id attribute from indicator at "+i.bus+i.path+" : "+e);
            }

            return null;
        });

        // filter illegal values
        indicators = indicators.filter(function(i) { return i !== null });

        // we're  done
        return indicators;
    } catch (e) {
        log("Error while trying to retrieve active indicators: "+e);
        log(e.stack);
    }

    return [];
}

function listenForChangedActives(clb) {
    getSNWProxy().connect("g-properties-changed", function(proxy, changed, invalidated) {
        // call clb if "RegisteredStatusNotifierItems" is among the changed properites
        let propList = Object.keys(changed.deep_unpack());

        if (propList.indexOf("RegisteredStatusNotifierItems") != -1) {
            clb();
        }

        return false;
    });
}

function cloneObject(obj) {
    var copy = {};
    for (var attr in obj) {
        if (obj.hasOwnProperty(attr)) copy[attr] = obj[attr];
    }
    return copy;
}

function commandOutputSync(command) {
    return GLib.spawn_command_line_sync(command)[1].toString().trim();
}

function debugInfoToClipboard(obj) {
    var debugInfo = {
        "Extension": Config.version,
        "Shell": ShellConfig.PACKAGE_VERSION,
        "Kernel": commandOutputSync("uname -a"),
        "Distribution": commandOutputSync("lsb_release -sd"),
        "Loaded Indicators": getActivesSync().join(" ")
    };

    var debugArr = [];
    for (let i in debugInfo) {
        debugArr.push(i + ": " + debugInfo[i]);
    }

    //HACK This would hit https://bugzilla.gnome.org/show_bug.cgi?id=579312
    //     But luckily, we can work around creating the Gtk.Clipboard instance
    /*var clipboard = Gtk.Clipboard.get_for_display(obj.get_display(), Gdk.atom_intern('CLIPBOARD', 0));
    clipboard.set_text(debugArr.join("\n"), -1);*/

    var entry = new Gtk.Entry();
    obj.get_parent().add(entry); // we need to add the widget to the window at least temporarily so it can find the screen

    entry.text = debugArr.join("\n");
    // GtkEditable at work here
    entry.select_region(0, -1); // select all
    entry.copy_clipboard();

    obj.get_parent().remove(entry);
}
