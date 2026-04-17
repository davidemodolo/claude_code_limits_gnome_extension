import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

function _formatTimeUntil(isoString) {
    if (!isoString) return 'unknown';
    const now = Date.now();
    const reset = new Date(isoString).getTime();
    let diff = Math.max(0, reset - now);

    const days = Math.floor(diff / 86400000);
    diff %= 86400000;
    const hours = Math.floor(diff / 3600000);
    diff %= 3600000;
    const minutes = Math.floor(diff / 60000);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
}

// ── Indicator (panel button + popup menu) ──────────────────────────

const ClaudeLimitsIndicator = GObject.registerClass(
class ClaudeLimitsIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.0, 'Claude Code Limits');

        this._ext = ext;
        this._settings = ext.getSettings();
        this._session = new Soup.Session();
        this._cancellable = new Gio.Cancellable();
        this._usageData = null;
        this._lastGoodData = null;
        this._isStale = false;
        this._timerId = null;
        this._tooltip = null;
        this._tooltipTimeoutId = null;
        this._signalIds = [];
        this._lastSessionNotif = 0;
        this._lastWeeklyNotif = 0;
        this._notifSource = null;
        this._loginProxy = null;
        this._sleepSignalId = null;

        this._buildPanel();
        this._buildMenu();
        this._connectHover();
        this._connectSettings();
        this._setupSleepMonitor();

        // Hide tooltip when menu opens
        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen) this._hideTooltip();
        });

        // Fetch immediately, then on timer
        this._fetchUsage();
        this._startTimer();
    }

    // ── Color helper ──────────────────────────────────────────────

    _colorForUsage(pct) {
        const warn = this._settings.get_int('threshold-warning');
        const crit = this._settings.get_int('threshold-critical');
        if (pct >= crit) return this._settings.get_string('color-critical');
        if (pct >= warn) return this._settings.get_string('color-warning');
        return this._settings.get_string('color-normal');
    }

    // ── Settings signals ──────────────────────────────────────────

    _connectSettings() {
        const s = this._settings;

        this._signalIds.push(
            s.connect('changed::refresh-interval', () => this._startTimer()));
        this._signalIds.push(
            s.connect('changed::panel-position', () => this._repositionPanel()));
        this._signalIds.push(
            s.connect('changed::panel-index', () => this._repositionPanel()));
        this._signalIds.push(
            s.connect('changed::retry-on-resume', () => this._setupSleepMonitor()));

        // Everything visual → full rebuild
        const rebuildKeys = [
            'panel-style', 'show-session', 'show-weekly',
            'show-reset-timers', 'show-tooltip',
            'bar-colored', 'threshold-warning', 'threshold-critical',
            'color-normal', 'color-warning', 'color-critical',
            'bar-width', 'bar-height', 'bar-radius', 'bar-spacing', 'bar-track-color',
            'text-format', 'stale-opacity',
        ];
        for (const key of rebuildKeys) {
            this._signalIds.push(s.connect(`changed::${key}`, () => {
                this._rebuildPanel();
                this._buildMenu();
                const data = this._usageData ?? this._lastGoodData;
                if (data) this._updateUI(data);
            }));
        }
    }

    // ── Panel positioning ─────────────────────────────────────────

    _repositionPanel() {
        const box = this._settings.get_string('panel-position');
        const index = this._settings.get_int('panel-index');
        const parent = this.container.get_parent();
        if (parent) parent.remove_child(this.container);

        let target;
        if (box === 'left') target = Main.panel._leftBox;
        else if (box === 'center') target = Main.panel._centerBox;
        else target = Main.panel._rightBox;

        target.insert_child_at_index(
            this.container, Math.min(index, target.get_n_children()));
    }

    // ── Panel label / bars ────────────────────────────────────────

    _buildPanel() {
        this._box = new St.BoxLayout({
            style_class: 'panel-status-menu-box claude-limits-box',
        });
        this.add_child(this._box);
        this._panelStyle = this._settings.get_string('panel-style');
        this._buildPanelContent();
    }

    _rebuildPanel() {
        this._box.destroy_all_children();
        this._label = null;
        this._sessionBar = null;
        this._weeklyBar = null;
        this._staleLabel = null;
        this._panelStyle = this._settings.get_string('panel-style');
        this._buildPanelContent();
    }

    _buildPanelContent() {
        if (this._panelStyle === 'minimal') {
            const showSession = this._settings.get_boolean('show-session');
            const showWeekly = this._settings.get_boolean('show-weekly');
            const spacing = this._settings.get_int('bar-spacing');
            this._box.set_style(`spacing: ${spacing}px;`);

            this._sessionBar = showSession ? this._makeBar() : null;
            this._weeklyBar = showWeekly ? this._makeBar() : null;

            this._staleLabel = new St.Label({
                text: '\u2605',
                y_align: Clutter.ActorAlign.CENTER,
                style: 'color: #888888; margin-left: 2px;',
            });
            this._staleLabel.hide();

            if (this._sessionBar) this._box.add_child(this._sessionBar);
            if (this._weeklyBar) this._box.add_child(this._weeklyBar);
            this._box.add_child(this._staleLabel);
        } else {
            this._box.set_style('');
            this._label = new St.Label({
                text: 'C: \u2026',
                y_align: Clutter.ActorAlign.CENTER,
                style_class: 'claude-limits-label',
            });
            this._box.add_child(this._label);
        }
    }

    _makeBar() {
        const w = this._settings.get_int('bar-width');
        const h = this._settings.get_int('bar-height');
        const r = this._settings.get_int('bar-radius');
        const trackColor = this._settings.get_string('bar-track-color');

        const track = new St.Widget({
            style_class: 'claude-limits-bar-track',
            style: `width: ${w}px; height: ${h}px; border-radius: ${r}px; background-color: ${trackColor};`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        track._fill = new St.Widget({
            style_class: 'claude-limits-bar-fill',
            style: `height: ${h}px;`,
        });
        track.add_child(track._fill);
        return track;
    }

    // ── Popup menu ────────────────────────────────────────────────

    _buildMenu() {
        this.menu.removeAll();

        const showSession = this._settings.get_boolean('show-session');
        const showWeekly = this._settings.get_boolean('show-weekly');
        const showResets = this._settings.get_boolean('show-reset-timers');

        // Header
        const header = new PopupMenu.PopupMenuItem('Claude Code Usage', {reactive: false});
        header.label.set_style('font-weight: bold;');
        this.menu.addMenuItem(header);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Session
        this._sessionItem = null;
        this._sessionResetItem = null;
        if (showSession) {
            this._sessionItem = new PopupMenu.PopupMenuItem('Session (5h):  \u2014', {reactive: false});
            this.menu.addMenuItem(this._sessionItem);
            if (showResets) {
                this._sessionResetItem = new PopupMenu.PopupMenuItem('  Resets in:  \u2014', {reactive: false});
                this._sessionResetItem.label.add_style_class_name('claude-limits-reset');
                this.menu.addMenuItem(this._sessionResetItem);
            }
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        // Weekly
        this._weeklyItem = null;
        this._weeklyResetItem = null;
        if (showWeekly) {
            this._weeklyItem = new PopupMenu.PopupMenuItem('Weekly  (7d):  \u2014', {reactive: false});
            this.menu.addMenuItem(this._weeklyItem);
            if (showResets) {
                this._weeklyResetItem = new PopupMenu.PopupMenuItem('  Resets in:  \u2014', {reactive: false});
                this._weeklyResetItem.label.add_style_class_name('claude-limits-reset');
                this.menu.addMenuItem(this._weeklyResetItem);
            }
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        // Status / last-updated
        this._statusItem = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._statusItem.label.set_style('color: #aaaaaa; font-size: 0.85em;');
        this.menu.addMenuItem(this._statusItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Refresh action
        const refreshItem = new PopupMenu.PopupMenuItem('\u21bb  Refresh');
        refreshItem.connect('activate', () => this._fetchUsage());
        this.menu.addMenuItem(refreshItem);
    }

    // ── Hover tooltip ─────────────────────────────────────────────

    _connectHover() {
        this.connect('enter-event', () => {
            if (!this._settings.get_boolean('show-tooltip')) return;
            if (this._tooltipTimeoutId) return;
            this._tooltipTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 350, () => {
                this._tooltipTimeoutId = null;
                if (this.hover && !this.menu.isOpen) this._showTooltip();
                return GLib.SOURCE_REMOVE;
            });
        });
        this.connect('leave-event', () => {
            if (this._tooltipTimeoutId) {
                GLib.Source.remove(this._tooltipTimeoutId);
                this._tooltipTimeoutId = null;
            }
            this._hideTooltip();
        });
    }

    _showTooltip() {
        if (!this._usageData) return;

        const lines = [];
        if (this._settings.get_boolean('show-session'))
            lines.push(`Session resets in ${_formatTimeUntil(this._usageData.five_hour?.resets_at)}`);
        if (this._settings.get_boolean('show-weekly'))
            lines.push(`Weekly resets in ${_formatTimeUntil(this._usageData.seven_day?.resets_at)}`);
        if (lines.length === 0) return;

        const text = lines.join('\n');

        if (!this._tooltip) {
            this._tooltip = new St.Label({
                style_class: 'dash-label claude-limits-tooltip',
                text,
            });
            Main.layoutManager.addTopChrome(this._tooltip);
        } else {
            this._tooltip.set_text(text);
        }

        // Position just below the panel button, centred
        const [btnX, btnY] = this.get_transformed_position();
        const btnW = this.get_width();
        const tipW = this._tooltip.get_preferred_width(-1)[1];
        const x = Math.max(0, Math.round(btnX + btnW / 2 - tipW / 2));
        const y = Math.round(btnY + this.get_height() + 6);
        this._tooltip.set_position(x, y);
        this._tooltip.show();
    }

    _hideTooltip() {
        this._tooltip?.hide();
    }

    // ── Sleep / resume monitor ────────────────────────────────────

    _setupSleepMonitor() {
        this._teardownSleepMonitor();
        if (!this._settings.get_boolean('retry-on-resume')) return;

        try {
            this._loginProxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SYSTEM,
                Gio.DBusProxyFlags.DO_NOT_AUTO_START,
                null,
                'org.freedesktop.login1',
                '/org/freedesktop/login1',
                'org.freedesktop.login1.Manager',
                null,
            );
            this._sleepSignalId = this._loginProxy.connectSignal(
                'PrepareForSleep',
                (_proxy, _sender, [going]) => {
                    if (!going) this._fetchUsage();
                },
            );
        } catch (e) {
            console.error('[Claude Limits] sleep monitor:', e.message);
        }
    }

    _teardownSleepMonitor() {
        if (this._sleepSignalId && this._loginProxy)
            this._loginProxy.disconnectSignal(this._sleepSignalId);
        this._sleepSignalId = null;
        this._loginProxy = null;
    }

    // ── Timer ─────────────────────────────────────────────────────

    _startTimer() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = null;
        }
        const interval = this._settings.get_int('refresh-interval');
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._fetchUsage();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // ── Credentials ───────────────────────────────────────────────

    _credentialsPath() {
        return GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
    }

    _loadCredentials() {
        try {
            const [ok, raw] = GLib.file_get_contents(this._credentialsPath());
            if (!ok) return null;
            const data = JSON.parse(new TextDecoder().decode(raw));
            return data.claudeAiOauth ?? null;
        } catch (e) {
            return null;
        }
    }

    _saveCredentials(oauth) {
        try {
            const path = this._credentialsPath();
            let existing = {};
            try {
                const [ok, raw] = GLib.file_get_contents(path);
                if (ok) existing = JSON.parse(new TextDecoder().decode(raw));
            } catch (_e) { /* fresh file */ }

            existing.claudeAiOauth = oauth;
            const json = JSON.stringify(existing, null, 2);

            const file = Gio.File.new_for_path(path);
            const stream = file.replace(null, false, Gio.FileCreateFlags.PRIVATE, null);
            stream.write_bytes(new GLib.Bytes(new TextEncoder().encode(json)), null);
            stream.close(null);
        } catch (e) {
            console.error('[Claude Limits] save credentials:', e.message);
        }
    }

    // ── Token refresh ─────────────────────────────────────────────

    _refreshToken(creds, callback) {
        const msg = Soup.Message.new('POST', TOKEN_URL);
        const body = [
            `grant_type=refresh_token`,
            `refresh_token=${encodeURIComponent(creds.refreshToken)}`,
            `client_id=${OAUTH_CLIENT_ID}`,
        ].join('&');
        msg.set_request_body_from_bytes(
            'application/x-www-form-urlencoded',
            new GLib.Bytes(new TextEncoder().encode(body)),
        );

        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable, (_s, res) => {
            try {
                const bytes = this._session.send_and_read_finish(res);
                const resp = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                if (!resp.access_token) {
                    callback(null);
                    return;
                }
                const updated = {
                    ...creds,
                    accessToken: resp.access_token,
                    expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000,
                };
                if (resp.refresh_token) updated.refreshToken = resp.refresh_token;
                this._saveCredentials(updated);
                callback(updated);
            } catch (e) {
                console.error('[Claude Limits] token refresh:', e.message);
                callback(null);
            }
        });
    }

    // ── Fetch usage ───────────────────────────────────────────────

    _fetchUsage() {
        const creds = this._loadCredentials();
        if (!creds) {
            this._setError('Not logged in \u2014 run `claude` first');
            return;
        }
        // If the token looks expired, refresh before fetching
        if (creds.expiresAt && Date.now() >= creds.expiresAt) {
            this._refreshToken(creds, newCreds => {
                if (newCreds) this._doFetch(newCreds.accessToken, true);
                else this._setError('Token refresh failed');
            });
            return;
        }
        this._doFetch(creds.accessToken, false);
    }

    _doFetch(accessToken, isRetry) {
        const msg = Soup.Message.new('GET', USAGE_URL);
        msg.request_headers.append('Authorization', `Bearer ${accessToken}`);
        msg.request_headers.append('anthropic-beta', 'oauth-2025-04-20');

        this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable, (_s, res) => {
            try {
                const bytes = this._session.send_and_read_finish(res);
                const status = msg.get_status();

                // On 401, attempt one token-refresh retry
                if (status === 401 && !isRetry) {
                    const creds = this._loadCredentials();
                    if (creds) {
                        this._refreshToken(creds, newCreds => {
                            if (newCreds) this._doFetch(newCreds.accessToken, true);
                            else this._setError('Auth expired');
                        });
                        return;
                    }
                }

                if (status !== 200) {
                    this._setError(`HTTP ${status}`);
                    return;
                }

                const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                this._usageData = data;
                this._lastGoodData = data;
                this._isStale = false;
                this._updateUI(data);
                this._checkNotifications(data);
            } catch (e) {
                if (!this._cancellable.is_cancelled())
                    this._setError('Fetch error');
            }
        });
    }

    // ── Notifications ─────────────────────────────────────────────

    _checkNotifications(data) {
        if (!this._settings.get_boolean('notifications-enabled')) return;
        const threshold = this._settings.get_int('notification-threshold');
        const cooldown = this._settings.get_int('notification-cooldown') * 1000;
        const now = Date.now();

        const sPct = Math.round(data.five_hour?.utilization ?? 0);
        const wPct = Math.round(data.seven_day?.utilization ?? 0);

        if (sPct >= threshold && now - this._lastSessionNotif > cooldown) {
            this._sendNotification(`Session (5h) usage at ${sPct}%`);
            this._lastSessionNotif = now;
        }
        if (wPct >= threshold && now - this._lastWeeklyNotif > cooldown) {
            this._sendNotification(`Weekly (7d) usage at ${wPct}%`);
            this._lastWeeklyNotif = now;
        }
    }

    _sendNotification(body) {
        try {
            if (!this._notifSource) {
                this._notifSource = new MessageTray.Source({
                    title: 'Claude Code Limits',
                    iconName: 'dialog-warning-symbolic',
                });
                Main.messageTray.add(this._notifSource);
            }
            const notification = new MessageTray.Notification({
                source: this._notifSource,
                title: 'Claude Code Limits',
                body,
            });
            this._notifSource.addNotification(notification);
        } catch (e) {
            console.error('[Claude Limits] notification:', e.message);
        }
    }

    // ── UI updates ────────────────────────────────────────────────

    _updateUI(data) {
        const sPct = Math.round(data.five_hour?.utilization ?? 0);
        const wPct = Math.round(data.seven_day?.utilization ?? 0);
        const maxPct = Math.max(sPct, wPct);

        // ── Panel indicator ───────────────────────────────────────
        if (this._panelStyle === 'minimal') {
            if (this._sessionBar) this._updateBar(this._sessionBar, sPct);
            if (this._weeklyBar) this._updateBar(this._weeklyBar, wPct);
            if (this._staleLabel) {
                if (this._isStale) {
                    this._staleLabel.set_text('\u2605');
                    this._staleLabel.show();
                } else {
                    this._staleLabel.hide();
                }
            }
        } else if (this._label) {
            const text = this._formatPanelText(data);
            this._label.set_text(text);
            if (this._isStale) {
                this._label.set_style('color: #888888;');
            } else {
                this._label.set_style(`color: ${this._colorForUsage(maxPct)};`);
            }
        }

        // ── Menu items ────────────────────────────────────────────
        if (this._sessionItem) {
            this._sessionItem.label.set_text(`Session (5h):  ${sPct}%`);
            this._sessionItem.label.set_style(`color: ${this._colorForUsage(sPct)};`);
        }
        if (this._sessionResetItem) {
            this._sessionResetItem.label.set_text(
                `  Resets in ${_formatTimeUntil(data.five_hour?.resets_at)}`);
        }

        if (this._weeklyItem) {
            this._weeklyItem.label.set_text(`Weekly  (7d):  ${wPct}%`);
            this._weeklyItem.label.set_style(`color: ${this._colorForUsage(wPct)};`);
        }
        if (this._weeklyResetItem) {
            this._weeklyResetItem.label.set_text(
                `  Resets in ${_formatTimeUntil(data.seven_day?.resets_at)}`);
        }

        // Timestamp
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        this._statusItem.label.set_text(`Updated ${hh}:${mm}`);
    }

    _formatPanelText(data) {
        const fmt = this._settings.get_string('text-format');
        const sPct = Math.round(data.five_hour?.utilization ?? 0);
        const wPct = Math.round(data.seven_day?.utilization ?? 0);

        let text = fmt
            .replace('{s}', sPct)
            .replace('{w}', wPct)
            .replace('{sr}', _formatTimeUntil(data.five_hour?.resets_at))
            .replace('{wr}', _formatTimeUntil(data.seven_day?.resets_at));

        if (this._isStale) text += '*';
        return text;
    }

    _updateBar(track, pct) {
        const colored = this._settings.get_boolean('bar-colored');
        const barW = this._settings.get_int('bar-width');
        const h = this._settings.get_int('bar-height');
        const r = this._settings.get_int('bar-radius');
        const staleOpacity = this._settings.get_double('stale-opacity');

        let color;
        if (this._isStale) {
            color = '#888888';
        } else {
            color = colored ? this._colorForUsage(pct) : '#ffffff';
        }

        const opacity = this._isStale ? `opacity: ${staleOpacity};` : '';
        const px = pct <= 0 ? 0 : Math.max(2, Math.round(barW * pct / 100));
        const fillRadius = Math.min(r, Math.floor(px / 2));
        track._fill.set_style(
            `width: ${px}px; height: ${h}px; background-color: ${color}; border-radius: ${fillRadius}px; ${opacity}`
        );
    }

    _setError(msg) {
        if (this._lastGoodData) {
            this._isStale = true;
            this._usageData = this._lastGoodData;
            this._updateUI(this._lastGoodData);
            this._statusItem.label.set_text(`${msg} (showing cached)`);
        } else {
            // No cached data at all
            if (this._panelStyle === 'minimal') {
                if (this._staleLabel) {
                    this._staleLabel.set_text('!');
                    this._staleLabel.set_style('color: #ff5555; margin-left: 2px;');
                    this._staleLabel.show();
                }
            } else if (this._label) {
                this._label.set_text(`C: ${msg}`);
                this._label.set_style('color: #888888;');
            }
            this._statusItem.label.set_text(msg);
        }
    }

    // ── Cleanup ───────────────────────────────────────────────────

    destroy() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = null;
        }
        if (this._tooltipTimeoutId) {
            GLib.Source.remove(this._tooltipTimeoutId);
            this._tooltipTimeoutId = null;
        }
        for (const id of this._signalIds) {
            this._settings.disconnect(id);
        }
        this._signalIds = [];
        this._teardownSleepMonitor();
        this._cancellable.cancel();
        if (this._tooltip) {
            Main.layoutManager.removeTopChrome(this._tooltip);
            this._tooltip.destroy();
            this._tooltip = null;
        }
        if (this._notifSource) {
            this._notifSource.destroy();
            this._notifSource = null;
        }
        this._session = null;
        super.destroy();
    }
});

// ── Extension entry point ─────────────────────────────────────────

export default class ClaudeLimitsExtension extends Extension {
    enable() {
        this._indicator = new ClaudeLimitsIndicator(this);
        const settings = this.getSettings();
        const box = settings.get_string('panel-position');
        const index = settings.get_int('panel-index');
        Main.panel.addToStatusArea(this.uuid, this._indicator, index, box);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
