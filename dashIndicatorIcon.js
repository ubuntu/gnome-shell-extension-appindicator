/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
// Copyright (C) 2013 Thomas Schaberreiter <thomassc@ee.oulu.fi>
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
const Main = imports.ui.main;
const Dash = imports.ui.dash;
const Lang = imports.lang;
const St = imports.gi.St;
const AppDisplay = imports.ui.appDisplay;
const AppFavorites = imports.ui.appFavorites;
const IconGrid = imports.ui.iconGrid;
const PopupMenu = imports.ui.popupMenu;
const Shell = imports.gi.Shell;


const DEFAULT_BACKGROUND_IMAGE ='avatar-default';
const STATUSICONSIZE=40;


const CustomDashIcon = new Lang.Class({
    Name: 'CustomDashIcon',
    Extends: Dash.DashItemContainer,

    _init: function(indicator) {
        this._indicator = indicator;
        this.parent();

        this.actor = new St.Button({ style_class: 'app-well-app',
            reactive: true,
            button_mask: St.ButtonMask.ONE | St.ButtonMask.TWO,
            can_focus: true,
            x_fill: true,
            y_fill: true });

        this.actor._delegate = this;
        this.childScale = 1;
        this.childOpacity = 255;
        this.setChild(this.actor);


        this._bckiconname=DEFAULT_BACKGROUND_IMAGE;
        this.actoraddedid=0;
        this.stateChangedId =0;
        this._appid="";
        this._favouriteposition=-1;
        this._application=null;

        //try to associate an app to the indicator
        let thisapp = Shell.AppSystem.get_default().lookup_app(this._indicator.id+'.desktop');

        if(thisapp)
        {
            this._application=thisapp;
            this._appid=thisapp.get_id();
            this._bckiconname=thisapp.get_app_info().get_icon().to_string();
            this.setLabelText(thisapp.get_name()); //use app name for label, if available

            //if it is a favourite, remove it (there is weired behaviour otherwise)
            if(AppFavorites.getAppFavorites().isFavorite(this._appid))
            {
                let favmap= AppFavorites.getAppFavorites()._getIds();

                for (let i=0;i<favmap.length;i++)
                {
                    if(favmap[i] == this._appid)
                    {
                        this._favouriteposition=i;
                        break;
                    }
                }
                AppFavorites.getAppFavorites()._removeFavorite(this._appid);
            }

            //block all other icons matching the indicator in dash, every time it is created
            this.actoraddedid= Main.overview._dash._box.connect('actor_added', Lang.bind(this,function(container, actor){
                if(actor.child && actor.child._delegate && actor.child._delegate.app)
                {
                    if(actor.child._delegate.app.get_id() == this._appid)
                    {
                        actor.destroy();
                    }
                }
            }));


            this.stateChangedId = thisapp.connect('notify::state', Lang.bind(this, this._onStateChanged));
            this._onStateChanged();
        }
        else
        {
            this.setLabelText(this._indicator.title);
        }

        this.icon = new CustomBaseIcon("", this._bckiconname,
                                       { setSizeManually: true,
                                         showLabel: false,
                                         createIcon: Lang.bind(this, this._createIcon) });

        this.icon.setIconSize(Main.overview._dash.iconSize);
        this.actor.add_actor(this.icon.actor);

        //connect button actors
        this.buttonpressid= this.actor.connect('button-press-event', Lang.bind(this, this._onButtonPress));
        this.entereventid= this.actor.connect('enter-event', Lang.bind(this,function(){
            this.showLabel();
        }));
        this.leaveeventid= this.actor.connect('leave-event', Lang.bind(this,function(){
            this.hideLabel();
        }));

        //make sure that opened window is focused
        this._windowattentionid = global.display.connect('window-demands-attention', Lang.bind(this, this._onWindowDemandsAttention));
        this._timestamp= new Date().getTime();

        //create the menu
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menu = new CustomAppIconMenu(this._indicator, this);
        this.menuopenstateid = this._menu.connect('open-state-changed', Lang.bind(this, function (menu, isPoppedUp) {
            if (!isPoppedUp)
            {
                this.actor.sync_hover();  //unselects the button if menu is popped down
                this.hideLabel();  //be sure the label is hidden.
            }
        }));

        this.menuoverviewid = Main.overview.connect('hiding', Lang.bind(this, function () { this._menu.close(); })); //close the menu when leaving overview
        this._menu.close(); //Initially close the menu!
        this._menuManager.addMenu(this._menu);

        //stuff would keep us alive forever if icon changes places
        var h = this._indicatorHandlerIds = [];
        h.push(this._indicator.connect('icon', Lang.bind(this, this._updateIcon)));
        h.push(this._indicator.connect('ready', Lang.bind(this, this._display)));
        h.push(this._indicator.connect('reset', Lang.bind(this, this._reset)));

        if (this._indicator.isReady) {
            //indicator already ready when adding? unheard of, but we still handle it.
            this._updateIcon();
            this._display();
        }
    },

    _onWindowDemandsAttention: function(display, window) {

        if(this._timestamp > new Date().getTime()-1000) //last appwindow open was more than one second before
        {
            Main.activateWindow(window);
        }
    },


    _display: function() {

        this._menu._setDbusMenu();

        //remove any appicon icons that match the app indicator id
        if(this._appid!="")
        {
            let children = Main.overview._dash._box.get_children().filter(function(actor) {
                return actor.child &&
                actor.child._delegate &&
                actor.child._delegate.app;
            });

            let numapps= children.length;

            for(let i=0;i<numapps;i++)
            {
                if(children[i].child._delegate.app.get_id() == this._appid)
                {
                    children[i].destroy();
                }
            }
        }

        Main.overview._dash._box.insert_child_at_index(this, Main.overview._dash._box.get_children().length);
        Main.overview._dash._redisplay(); //make sure the size of the dash is correct
    },


    _onStateChanged: function() {
        if (this._application.state != Shell.AppState.STOPPED)
        {
            this.actor.add_style_class_name('running');
            Main.overview.hide();
        }
        else
            this.actor.remove_style_class_name('running');
    },

    _createIcon: function(size) {
        let iconsize= ((size < STATUSICONSIZE) ? size : STATUSICONSIZE);  //if requested size is smaller than maximum size, use requested size
        return this._indicator.createIcon(iconsize);
    },

    _updateIcon: function() {
        this.icon._createIconTexture(Main.overview._dash.iconSize);
    },


    _reset: function() {
        this._updateIcon();
        if (this._menu.reset) {
            this._menu.reset();
        }
    },

    _onButtonPress: function(actor, event) {
        let button = event.get_button();
        if (button == 1) {
            this._timestamp= new Date().getTime(); //set new time for open window
            this._indicator.open();
            return true;
        }
        else if (button == 3) {
            this._menu.popup();
            this.actor.set_hover(true);
            this._menuManager.ignoreRelease();
            return true;
        }

        return false;
    },

    destroy: function() {
        log('destroying '+this._indicator.id+'...');


        //destroy stuff owned by us
        this._indicatorHandlerIds.forEach(this._indicator.disconnect.bind(this._indicator));
        if (this._menu.destroyDbusMenu) {
            this._menu.destroyDbusMenu();
        }

        //disconnect all signals
        this.actor.disconnect(this.buttonpressid);
        this.actor.disconnect(this.entereventid);
        this.actor.disconnect(this.leaveeventid);
        this._menu.disconnect(this.menuopenstateid);
        Main.overview.disconnect(this.menuoverviewid);
        if(this.actoraddedid!=0)
            Main.overview._dash._box.disconnect(this.actoraddedid);

        if(this._appid!="" && this._favouriteposition!=-1) //re-add favourite, if it was removed
        {
            AppFavorites.getAppFavorites()._addFavorite(this._appid, this._favouriteposition);
        }

        if(this._application!=null && this.stateChangedId!=0)
            this._application.disconnect(this.stateChangedId);

        global.display.disconnect(this._windowattentionid);

        this.parent();

        Main.overview._dash._redisplay(); //make sure the size of the dash is correct
    }
});



const CustomAppIconMenu = new Lang.Class({
    Name: 'CustomAppIconMenu',
    Extends: AppDisplay.AppIconMenu,

    _init: function(indicator, source) {
        this._indicator=indicator;
        this.parent(source);
    },

    _setDbusMenu: function() {
        this._indicator.getMenu((function(menu){ //bind the indicator menu to app indicator menu
            if (menu != null) {
                menu.attach(this);
            }
        }).bind(this));
    },

    _redisplay: function() {},

    popup: function(activatingButton) {
        this.open();
    },

    _onActivate: function (actor, child) {}

});




//allows to add a second icon appearing below the other one
const CustomBaseIcon = new Lang.Class({
    Name: 'CustomBaseIcon',
    Extends: IconGrid.BaseIcon,

    _init : function(label, backgroundimgname, params) {
        this.parent(label, params);


        this._iconBin.x_align=St.Align.START;
        this._iconBin.y_align=St.Align.END;

        this._bckimgname= backgroundimgname;

        this._bkgbox = new St.Bin({ x_align: St.Align.MIDDLE,
            y_align: St.Align.MIDDLE });

        this.actor.get_child().add_actor(this._bkgbox);
    },



    _allocate: function(actor, box, flags) {
        this.parent(actor, box, flags);
        this._bkgbox.allocate(this._iconBin.get_allocation_box(),flags);
    },



    _createIconTexture: function(size) {
        this.parent(size);

        if(this._bkgbox.child)
            this._bkgbox.child.destroy();

        this._bkgbox.child=  new St.Icon({ icon_name: this._bckimgname,
                                           icon_size: this.iconSize,
                                           style_class: 'show-apps-icon',
                                           track_hover: false });
        this._bkgbox.set_size(this.iconSize, this.iconSize);
        this._iconBin.raise_top();
    }
});

