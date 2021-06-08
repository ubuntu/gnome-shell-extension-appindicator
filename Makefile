# simple helper makefile, handles schema compilation, translations and zip file creation

.PHONY= zip-file clean
SHELL := /usr/bin/env bash

# files that go into the zip
ZIP= $(wildcard *.js) metadata.json $(wildcard interfaces-xml/*) \
     $(wildcard locale/*/*/*.mo) $(wildcard schemas/*.xml) \
     schemas/gschemas.compiled

PO_FILES = $(wildcard locale/*.po)
GETTEXT_DOMAIN = 'AppIndicatorExtension'

all: compile-schema translations

zip-file: $(ZIP) compile-schema translations
	@echo +++ Packing archive
	@mkdir -p build
	@rm -f build/appindicator-support.zip
	@zip build/appindicator-support.zip $(ZIP) locale/*/*/*.mo
	$(MAKE) clean-translations clean-gschemas

compile-schema: ./schemas/org.gnome.shell.extensions.appindicator.gschema.xml
	@echo +++ Compiling schema
	@glib-compile-schemas schemas

schemas/gschemas.compiled: compile-schema

check:
	eslint $(shell find -name '*.js')

translations: $(PO_FILES)
	@echo +++ Processing translations
	@for pofile in $^; do \
		localedir="$${pofile/.po}/LC_MESSAGES/"; \
		mkdir -p $$localedir; \
		msgfmt "$$pofile" -o "$$localedir/"$(GETTEXT_DOMAIN).mo; \
	done

clean-translations:
	rm -rf ls -d locale/*/

clean-gschemas:
	rm -f schemas/gschemas.compiled

clean: clean-translations clean-gschemas
	@echo +++ Removing all generated files
	rm -rf build
