UUID = claude-limits@davide.modolo
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: build install uninstall clean restart

build:
	glib-compile-schemas schemas/

pack: build
	zip -r $(UUID).zip metadata.json extension.js prefs.js stylesheet.css schemas/

install: build
	mkdir -p $(INSTALL_DIR)/schemas
	cp metadata.json extension.js prefs.js stylesheet.css $(INSTALL_DIR)/
	cp schemas/org.gnome.shell.extensions.claude-limits.gschema.xml $(INSTALL_DIR)/schemas/
	cp schemas/gschemas.compiled $(INSTALL_DIR)/schemas/
	@echo ""
	@echo "Installed to $(INSTALL_DIR)"
	@echo "Enable with:  gnome-extensions enable $(UUID)"
	@echo "Then restart GNOME Shell (log out/in on Wayland, or Alt+F2 → r on X11)"

uninstall:
	rm -rf $(INSTALL_DIR)
	@echo "Uninstalled. Restart GNOME Shell to take effect."

clean:
	rm -f schemas/gschemas.compiled

restart:
	@echo "On X11:    Alt+F2 → type 'r' → Enter"
	@echo "On Wayland: log out and log back in"
