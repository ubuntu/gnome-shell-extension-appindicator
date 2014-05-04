# simple helper makefile, handles schema compilation, translations and zip file creation

.PHONY= zip-file pot mo schema all

# files that go into the zip
ZIP= $(wildcard *.js) metadata.json $(wildcard schemas/*) $(wildcard locale/*/LC_MESSAGES/*) $(wildcard interfaces-xml/*)

all: pot mo schema config.js

# shortcuts
pot: po/messages.pot
schema: schemas/gschemas.compiled

mo: $(wildcard po/*.po)
	mkdir -p locale
	for x in $^; do\
		name=$$(basename $$x | cut -d'.' -f1); \
		mkdir -p locale/$$name/LC_MESSAGES; \
		msgfmt $$x -o locale/$$name/LC_MESSAGES/gnome-shell-appindicator-support.mo; \
	done;

config.js: config.js.sh
	sh config.js.sh > config.js

po/messages.pot: prefs.js
	xgettext --from-code=UTF-8 -k_ -o po/messages.pot prefs.js

schemas/gschemas.compiled: $(wildcard schemas/*.gschema.xml)
	glib-compile-schemas schemas

zip-file: $(ZIP) mo schema config.js
	mkdir -p build
	rm -f build/appindicator-support.zip
	zip build/appindicator-support.zip $(ZIP) config.js

clean:
	rm -rf build
	rm -f config.js
	rm -f schemas/gschemas.compiled
	rm -f po/messages.pot
	rm -rf locale
