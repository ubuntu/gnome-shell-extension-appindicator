#!/usr/bin/gjs -m

/*
 * Creates a status notifier item whose menu reorders its existing
 * items every few seconds, keeping their ids stable, so that hosts
 * receive pure item moves instead of removals and additions.
 *
 * With the menu open, the items should visibly rotate (issue #632).
 *
 * Only requires GLib and Gio introspection data.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

const WATCHER_BUS_NAME = 'org.kde.StatusNotifierWatcher';
const WATCHER_OBJECT_PATH = '/StatusNotifierWatcher';
const ITEM_OBJECT_PATH = '/StatusNotifierItem';
const MENU_OBJECT_PATH = '/ReorderTestMenu';
const REORDER_INTERVAL_SECONDS = 3;

const StatusNotifierItemInterface = `
<node>
  <interface name="org.kde.StatusNotifierItem">
    <property name="Category" type="s" access="read"/>
    <property name="Id" type="s" access="read"/>
    <property name="Title" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="IconName" type="s" access="read"/>
    <property name="ItemIsMenu" type="b" access="read"/>
    <property name="Menu" type="o" access="read"/>
    <method name="Activate">
      <arg name="x" type="i" direction="in"/>
      <arg name="y" type="i" direction="in"/>
    </method>
    <method name="SecondaryActivate">
      <arg name="x" type="i" direction="in"/>
      <arg name="y" type="i" direction="in"/>
    </method>
    <method name="ContextMenu">
      <arg name="x" type="i" direction="in"/>
      <arg name="y" type="i" direction="in"/>
    </method>
    <method name="Scroll">
      <arg name="delta" type="i" direction="in"/>
      <arg name="orientation" type="s" direction="in"/>
    </method>
  </interface>
</node>`;

const DBusMenuInterface = `
<node>
  <interface name="com.canonical.dbusmenu">
    <property name="Version" type="u" access="read"/>
    <property name="TextDirection" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="IconThemePath" type="as" access="read"/>
    <method name="GetLayout">
      <arg name="parentId" type="i" direction="in"/>
      <arg name="recursionDepth" type="i" direction="in"/>
      <arg name="propertyNames" type="as" direction="in"/>
      <arg name="revision" type="u" direction="out"/>
      <arg name="layout" type="(ia{sv}av)" direction="out"/>
    </method>
    <method name="GetGroupProperties">
      <arg name="ids" type="ai" direction="in"/>
      <arg name="propertyNames" type="as" direction="in"/>
      <arg name="properties" type="a(ia{sv})" direction="out"/>
    </method>
    <method name="GetProperty">
      <arg name="id" type="i" direction="in"/>
      <arg name="name" type="s" direction="in"/>
      <arg name="value" type="v" direction="out"/>
    </method>
    <method name="Event">
      <arg name="id" type="i" direction="in"/>
      <arg name="eventId" type="s" direction="in"/>
      <arg name="data" type="v" direction="in"/>
      <arg name="timestamp" type="u" direction="in"/>
    </method>
    <method name="EventGroup">
      <arg name="events" type="a(isvu)" direction="in"/>
      <arg name="idErrors" type="ai" direction="out"/>
    </method>
    <method name="AboutToShow">
      <arg name="id" type="i" direction="in"/>
      <arg name="needUpdate" type="b" direction="out"/>
    </method>
    <method name="AboutToShowGroup">
      <arg name="ids" type="ai" direction="in"/>
      <arg name="updatesNeeded" type="ai" direction="out"/>
      <arg name="idErrors" type="ai" direction="out"/>
    </method>
    <signal name="ItemsPropertiesUpdated">
      <arg name="updatedProps" type="a(ia{sv})"/>
      <arg name="removedProps" type="a(ias)"/>
    </signal>
    <signal name="LayoutUpdated">
      <arg name="revision" type="u"/>
      <arg name="parent" type="i"/>
    </signal>
  </interface>
</node>`;

const labels = new Map([
    [1, 'First item'],
    [2, 'Second item'],
    [3, 'Third item'],
    [4, 'Fourth item'],
    [5, 'Fifth item'],
]);

let order = [...labels.keys()];
let revision = 1;

const itemProperties = id =>
    ({label: new GLib.Variant('s', labels.get(id) ?? '')});

const itemVariant = id =>
    new GLib.Variant('(ia{sv}av)', [id, itemProperties(id), []]);

const menuImplementation = {
    Version: 3,
    TextDirection: 'ltr',
    Status: 'normal',
    IconThemePath: [],
    GetLayout(parentId, recursionDepth, _propertyNames) {
        const root = parentId === 0;
        const children = root && recursionDepth !== 0
            ? order.map(id => itemVariant(id)) : [];
        const layout = root
            ? new GLib.Variant('(ia{sv}av)', [0,
                {'children-display': new GLib.Variant('s', 'submenu')}, children])
            : itemVariant(parentId);
        return GLib.Variant.new_tuple(
            [GLib.Variant.new_uint32(revision), layout]);
    },
    GetGroupProperties(ids, _propertyNames) {
        const rows = order.filter(id => !ids.length || ids.includes(id))
            .map(id => [id, itemProperties(id)]);
        return new GLib.Variant('(a(ia{sv}))', [rows]);
    },
    GetProperty(id, name) {
        return itemProperties(id)[name] ?? new GLib.Variant('s', '');
    },
    Event(id, eventId, _data, _timestamp) {
        if (eventId === 'clicked')
            print(`Clicked item ${id} (${labels.get(id)})`);
    },
    EventGroup(events) {
        events.forEach(([id, eventId, data, timestamp]) =>
            this.Event(id, eventId, data, timestamp));
        return [];
    },
    AboutToShow(_id) {
        return true;
    },
    AboutToShowGroup(ids) {
        return new GLib.Variant('(aiai)', [ids, []]);
    },
};

const itemImplementation = {
    Category: 'ApplicationStatus',
    Id: 'reorder-test-tool',
    Title: 'Menu reordering test',
    Status: 'Active',
    IconName: 'start-here',
    ItemIsMenu: true,
    Menu: MENU_OBJECT_PATH,
    Activate(_x, _y) {},
    SecondaryActivate(_x, _y) {},
    ContextMenu(_x, _y) {},
    Scroll(_delta, _orientation) {},
};

const itemExport = Gio.DBusExportedObject.wrapJSObject(
    StatusNotifierItemInterface, itemImplementation);
itemExport.export(Gio.DBus.session, ITEM_OBJECT_PATH);

const menuExport = Gio.DBusExportedObject.wrapJSObject(
    DBusMenuInterface, menuImplementation);
menuExport.export(Gio.DBus.session, MENU_OBJECT_PATH);

Gio.bus_watch_name(Gio.BusType.SESSION, WATCHER_BUS_NAME,
    Gio.BusNameWatcherFlags.NONE, () => {
        Gio.DBus.session.call(WATCHER_BUS_NAME, WATCHER_OBJECT_PATH,
            WATCHER_BUS_NAME, 'RegisterStatusNotifierItem',
            new GLib.Variant('(s)', [ITEM_OBJECT_PATH]), null,
            Gio.DBusCallFlags.NONE, -1, null, (connection, result) => {
                connection.call_finish(result);
                print('Registered with the status notifier watcher');
            });
    }, () => print('No status notifier watcher found'));

GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REORDER_INTERVAL_SECONDS,
    () => {
        order.push(order.shift());
        revision += 1;
        menuExport.emit_signal('LayoutUpdated',
            new GLib.Variant('(ui)', [revision, 0]));
        print(`Expected order: ${order.map(id => labels.get(id)).join(', ')}`);
        return GLib.SOURCE_CONTINUE;
    });

new GLib.MainLoop(null, false).run();
