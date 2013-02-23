/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Lang = imports.lang;
const St = imports.gi.St;
const GdkPixbuf = imports.gi.GdkPixbuf;
const Clutter = imports.gi.Clutter;
const Cogl = imports.gi.Cogl;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

/*
 * UtilMixin:
 * Mixes in the given properties in _mixin into the object
 *
 */
const Mixin = new Lang.Class({
	Name: 'UtilMixin',
	
	_init: function() {
		//actually we do our work in attach()
	},
	
	_mixin: {},
	
	_conserve: [],
	
	attach: function(o) {
		if (!this._mixin) return;
		if (this._conserve && this._conserve.forEach) {
			o._conserved = {};
			this._conserve.forEach(function(e) {
					if (e in o) {
						o._conserved[e] = o[e];
					} else if (o.prototype && e in o.prototype) {
						o._conserved[e] = o.prototype[e];
					} else {
						log("WARNING: attempted to conserve property '"+e+"' but not found.");
					}
			});
		}
		for (var i in this._mixin) {
			o[i] = this._mixin[i];
		}
		if (this._mixinInit) {
			this._mixinInit.apply(o);
		}
	}
});

const createActorFromPixmap = function(pixmap, icon_size) {
	if (!(pixmap && pixmap.length)) return null;
	// pixmap is actually an array of icons, so that hosts can pick the
    // best size (here considered as the area covered by the icon)
    // XXX: should we use sum of width and height instead? or consider
    // only one dimension?
    let best = 0;
    let bestHeight = pixmap[0][1];
    let goal = icon_size;
    for (let i = 1; i < pixmap.length; i++) {
        let height = pixmap[i][1];
        if (Math.abs(goal - height) < Math.abs(goal - bestHeight)) {
            best = i;
            bestHeight = height;
        }
    }
    let [width, height, imageData] = pixmap[best];
    // each image is ARGB32
    // XXX: we're not getting a rowstride! let's hope images are compressed enough
    let rowstride = width * 4;
    return St.TextureCache.get_default().load_from_raw(imageData, imageData.length,
                                                       true, width, height, rowstride,
                                                       icon_size);
};

//FIXME: Wouldn't it be way faster and less memory hungry to just write it to a temporary file and load it afterwards?
const createActorFromMemoryImage = function(data) {
	var stream = Gio.MemoryInputStream.new_from_data(byteArrayFromString(data));
	var pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
	pixbuf.savev("/tmp/debugbuf.png", "png", [], []);
	var img = new Clutter.Image();
	img.set_data(pixbuf.get_pixels(), pixbuf.get_has_alpha() ? Cogl.PixelFormat.RGBA_8888 : Cogl.PixelFormat.RGB_888,
				 pixbuf.get_width(), pixbuf.get_height(), pixbuf.get_rowstride());
	var actor = new Clutter.Actor();
	actor.set_content_scaling_filters(Clutter.ScalingFilter.TRILINEAR, Clutter.ScalingFilter.LINEAR);
	actor.set_content_gravity(Clutter.Gravity.NORTH_WEST);
	actor.set_content(img); 
	actor.set_size(pixbuf.get_width(), pixbuf.get_height());
	var widget = new St.Widget();
	widget.add_actor(actor);
	return widget;
}

//HACK: byteArray.fromString() doesn't accept our strings because of embedded nuls.
//      This honestly can't be efficient in no way.
const byteArrayFromString = function(data) {
	var data_length = data.length;
	var array = new imports.byteArray.ByteArray(data_length);
	for (var i = 0; i < data_length; i++) {
		array[i] = data.charCodeAt(i);
	}
	return array;
}
