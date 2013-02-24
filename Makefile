# simple helper makefile, handles schema compilation, translations and zip file creation

.PHONY= zip-file pot mo schema all

ZIP= $(wildcard *.js) metadata.json $(wildcard schemas/*) $(wildcard locale/*/LC_MESSAGES/*)

po/messages.pot: prefs.js
	xgettext -k_ -o po/messages.pot prefs.js
	
pot: po/messages.pot

mo: $(wildcard po/*.po)
	mkdir -p locale
	for x in $^; do\
		name=$$(basename $$x | cut -d'.' -f1); \
		mkdir -p locale/$$name/LC_MESSAGES; \
		msgfmt $$x -o locale/$$name/LC_MESSAGES/gnome-shell-appindicator-support.mo; \
	done;
	
schemas/gschemas.compiled: $(wildcard schemas/*.gschema.xml)
	glib-compile-schemas schemas
	
schema: schemas/gschemas.compiled

zip-file: $(ZIP)
	mkdir -p build
	rm -f build/appindicator-support.zip
	zip build/appindicator-support.zip $(ZIP)

all: pot mo schema