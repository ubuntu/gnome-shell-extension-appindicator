# simple helper makefile, handles schema compilation, translations and zip file creation

.PHONY= zip-file clean

# files that go into the zip
ZIP= $(wildcard *.js) metadata.json $(wildcard interfaces-xml/*) \
     $(wildcard locale/*) $(wildcard schemas/*)

PO_FILES= $(wildcard locale/*/LC_MESSAGES/*.po)

all: zip-file

zip-file: $(ZIP) compile-schema translations
	@echo +++ Packing archive
	@mkdir -p build
	@rm -f build/appindicator-support.zip
	@zip build/appindicator-support.zip $(ZIP)

compile-schema: ./schemas/org.gnome.shell.extensions.appindicator.gschema.xml
	@echo +++ Compiling schema
	@glib-compile-schemas schemas

check:
	eslint $(shell find -name '*.js')

translations: $(PO_FILES)
	@echo +++ Processing translations
	@for pofile in $^; do \
		msgfmt "$$pofile" -o `echo $$pofile | sed 's/po$$/mo/'`; \
	done

clean:
	rm -rf build
