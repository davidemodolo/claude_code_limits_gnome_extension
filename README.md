# Claude Code Limits — GNOME Shell Extension

A GNOME Shell extension (46–50) that displays your Claude Code usage limits (session and weekly) in the top bar.

## What it does

- Displays `S:37% W:26%` in the top bar (session 5h / weekly 7d usage)
- **Color-coded**: green (<60%), yellow (60-80%), red (>80%)
- **Hover tooltip** shows "Session resets in Xh Xm / Weekly resets in Xd Xh"
- **Click** opens a popup menu with full details: reset times, last-updated timestamp, and a manual refresh button

## Authentication

No manual setup needed — it reads the OAuth token from `~/.claude/.credentials.json` which is auto-created when you log in via `claude`. It also handles automatic token refresh when the token expires.

## Data sources

The extension gets usage data two ways and uses whichever is fresher:

1. **Usage API** — polls `api.anthropic.com/api/oauth/usage` on the configured interval.
2. **Local statusline cache** (optional) — watches `~/.claude/usage-cache.json` and updates live whenever it changes. This lets you see up-to-date numbers during an active Claude Code session *without* spending the usage endpoint's request quota.

To enable the cache source, install the included statusline script and point Claude Code at it:

```bash
cp statusline-usage.py ~/.claude/statusline-usage.py
chmod +x ~/.claude/statusline-usage.py
```

Then add it to `~/.claude/settings.json`:

```json
"statusLine": {
  "type": "command",
  "command": "/home/USER/.claude/statusline-usage.py"
}
```

The script prints a short status line (model · context % · 5h % · 7d %) and, as a side effect, mirrors the rate-limit data Claude Code pipes in to `~/.claude/usage-cache.json` (written atomically so the extension never reads a partial file). The extension only trusts cache entries newer than 5 minutes and never moves backwards to older data.

## Reliability

- **Rate-limit aware**: the usage endpoint only allows ~7 requests per 5 minutes, so the refresh interval is capped at a 60s minimum. On HTTP 429 the extension honors the `Retry-After` header.
- **Retry with backoff**: a failed fetch retries at 10s / 30s / 90s instead of waiting out the full interval.
- **Network & sleep aware**: refetches when connectivity returns and ~3s after resuming from sleep.
- **Graceful staleness**: a single failed poll doesn't discard fresh data — cached values are only marked stale once meaningfully old, and the menu shows e.g. `Rate limited · cached 2m ago`.

## Settings

Configurable refresh interval (default: 5 minutes, minimum 60s) via GNOME Extensions preferences.

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
extension.js           — panel indicator, OAuth, usage API, cache watcher, tooltip
prefs.js               — settings UI (refresh interval)
statusline-usage.py    — optional Claude Code statusline that feeds the local cache
stylesheet.css         — styling
schemas/               — GSettings schema
Makefile               — build/install/uninstall
```

## Note

The usage API (`api.anthropic.com/api/oauth/usage`) is undocumented/internal — Anthropic could change it without notice, but it's the same endpoint Claude Code itself uses.
</content>
</invoke>
