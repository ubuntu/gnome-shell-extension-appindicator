/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
// A collection of DBus interface declarations
//
// Scraped from various tarballs or aquired using debugging tools

const StatusNotifierItem = <interface name="org.kde.StatusNotifierItem">
    <property name="Category" type="s" access="read"/>
    <property name="Id" type="s" access="read"/>
    <property name="Title" type="s" access="read"/>
    <property name="Status" type="s" access="read"/>
    <property name="WindowId" type="i" access="read"/>
    <property name="Menu" type="o" access="read" />

    <!-- main icon -->
    <!-- names are preferred over pixmaps -->
    <property name="IconName" type="s" access="read" />
    <property name="IconThemePath" type="s" access="read" />

    <!-- struct containing width, height and image data-->
    <!-- implementation has been dropped as of now -->
    <property name="IconPixmap" type="a(iiay)" access="read" />

    <!-- not used in ayatana code, no test case so far -->
    <property name="OverlayIconName" type="s" access="read"/>
    <property name="OverlayIconPixmap" type="a(iiay)" access="read" />

    <!-- Requesting attention icon -->
    <property name="AttentionIconName" type="s" access="read"/>

    <!--same definition as image-->
    <property name="AttentionIconPixmap" type="a(iiay)" access="read" />

    <!-- tooltip data -->
    <!-- unimplemented as of now -->
    <!--(iiay) is an image-->
    <property name="ToolTip" type="(sa(iiay)ss)" access="read" />


    <!-- interaction: actually, we do not use them. -->
    <method name="Activate">
        <arg name="x" type="i" direction="in"/>
        <arg name="y" type="i" direction="in"/>
    </method>

    <!-- Signals: the client wants to change something in the status-->
    <signal name="NewTitle"></signal>
    <signal name="NewIcon"></signal>
    <signal name="NewIconThemePath">
        <arg type="s" name="icon_theme_path" direction="out" />
    </signal>
    <signal name="NewAttentionIcon"></signal>
    <signal name="NewOverlayIcon"></signal>
    <signal name="NewToolTip"></signal>
    <signal name="NewStatus">
        <arg name="status" type="s" />
    </signal>

    <!-- ayatana labels -->
    <signal name="XAyatanaNewLabel">
        <arg type="s" name="label" direction="out" />
        <arg type="s" name="guide" direction="out" />
    </signal>
    <property name="XAyatanaLabel" type="s" access="read" />
    <property name="XAyatanaLabelGuide" type="s" access="read" /> <!-- unimplemented -->


</interface>;

const Properties = <interface name="org.freedesktop.DBus.Properties">
    <method name="Get">
        <arg type="s" direction="in" />
        <arg type="s" direction="in" />
        <arg type="v" direction="out" />
    </method>
    <method name="GetAll">
        <arg type="s" direction="in" />
        <arg type="a{sv}" direction="out" />
    </method>
    <signal name="PropertiesChanged">
        <arg type="s" direction="out" />
        <arg type="a{sv}" direction="out" />
        <arg type="as" direction="out" />
    </signal>
</interface>;

//copied from libdbusmenu
const DBusMenu = <interface name="com.canonical.dbusmenu">
<!-- Properties -->
    <property name="Version" type="u" access="read">
    </property>
    <property name="TextDirection" type="s" access="read">
    </property>
    <property name="Status" type="s" access="read">
    </property>
    <property name="IconThemePath" type="as" access="read">
    </property>
<!-- Functions -->
    <method name="GetLayout">
        <arg type="i" name="parentId" direction="in" />
        <arg type="i" name="recursionDepth" direction="in" />
        <arg type="as" name="propertyNames" direction="in"  />
        <arg type="u(ia{sv}av)" name="layout" direction="out" />
    </method>
    <method name="GetGroupProperties">
        <arg type="ai" name="ids" direction="in" >
        </arg>
        <arg type="as" name="propertyNames" direction="in" >
        </arg>
        <arg type="a(ia{sv})" name="properties" direction="out" >
        </arg>
    </method>
    <method name="GetProperty">
        <arg type="i" name="id" direction="in">
        </arg>
        <arg type="s" name="name" direction="in">
        </arg>
        <arg type="v" name="value" direction="out">
        </arg>
    </method>
    <method name="Event">
        <arg type="i" name="id" direction="in" >
        </arg>
        <arg type="s" name="eventId" direction="in" >
        </arg>
        <arg type="v" name="data" direction="in" >
        </arg>
        <arg type="u" name="timestamp" direction="in" >
        </arg>
    </method>
    <method name="EventGroup">
        <arg type="a(isvu)" name="events" direction="in">
        </arg>
        <arg type="ai" name="idErrors" direction="out">
        </arg>
    </method>
    <method name="AboutToShow">
        <arg type="i" name="id" direction="in">
        </arg>
        <arg type="b" name="needUpdate" direction="out">
        </arg>
    </method>
    <method name="AboutToShowGroup">
        <arg type="ai" name="ids" direction="in">
        </arg>
        <arg type="ai" name="updatesNeeded" direction="out">
        </arg>
        <arg type="ai" name="idErrors" direction="out">
        </arg>
    </method>
<!-- Signals -->
    <signal name="ItemsPropertiesUpdated">
        <arg type="a(ia{sv})" name="updatedProps" direction="out" />
        <arg type="a(ias)" name="removedProps" direction="out" />
    </signal>
    <signal name="LayoutUpdated">
        <arg type="u" name="revision" direction="out" />
        <arg type="i" name="parent" direction="out" />
    </signal>
    <signal name="ItemActivationRequested">
        <arg type="i" name="id" direction="out" >
        </arg>
        <arg type="u" name="timestamp" direction="out" >
        </arg>
    </signal>
<!-- End of interesting stuff -->
</interface>

const StatusNotifierWatcher = <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem">
        <arg type="s" direction="in" />
    </method>
    <method name="RegisterNotificationHost">
        <arg type="s" direction="in" />
    </method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read" />
    <method name="ProtocolVersion">
        <arg type="s" direction="out" />
    </method>
    <method name="IsNotificationHostRegistered">
        <arg type="b" direction="out" />
    </method>
    <signal name="ServiceRegistered">
        <arg type="s" direction="out" />
    </signal>
    <signal name="ServiceUnregistered">
        <arg type="s" direction="out" />
    </signal>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read" />
</interface>;


