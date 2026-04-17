# Claude Code Limits — GNOME Shell Extension

A GNOME Shell 46 extension that displays your Claude Code usage limits (session and weekly) in the top bar.

## What it does

- Displays `S:37% W:26%` in the top bar (session 5h / weekly 7d usage)
- **Color-coded**: green (<60%), yellow (60-80%), red (>80%)
- **Hover tooltip** shows "Session resets in Xh Xm / Weekly resets in Xd Xh"
- **Click** opens a popup menu with full details: reset times, last-updated timestamp, and a manual refresh button

## Authentication

No manual setup needed — it reads the OAuth token from `~/.claude/.credentials.json` which is auto-created when you log in via `claude`. It also handles automatic token refresh when the token expires.

## Settings

Configurable refresh interval (default: 5 minutes) via GNOME Extensions preferences.

## Installation

```bash
make install
```

Since Wayland requires a full session restart to load new extensions, **log out and log back in**, then:

```bash
gnome-extensions enable claude-limits@davide.modolo
```

Or enable it from the **Extensions** app / GNOME Extensions Manager.

## Reinstall after edits

```bash
make install
# then log out/in to reload
```

## Uninstall

```bash
make uninstall
```

## Project structure

```
metadata.json          — extension metadata
extension.js           — panel indicator, OAuth, usage API, tooltip
prefs.js               — settings UI (refresh interval)
stylesheet.css         — styling
schemas/               — GSettings schema
Makefile               — build/install/uninstall
```

## Note

The usage API (`api.anthropic.com/api/oauth/usage`) is undocumented/internal — Anthropic could change it without notice, but it's the same endpoint Claude Code itself uses.
