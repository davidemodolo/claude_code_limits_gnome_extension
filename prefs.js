import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class ClaudeLimitsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        this._addGeneralPage(window, settings);
        this._addAppearancePage(window, settings);
        this._addNotificationsPage(window, settings);
        this._addAboutPage(window);
    }

    // ── General ───────────────────────────────────────────────────

    _addGeneralPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });

        // Data
        const dataGroup = new Adw.PreferencesGroup({title: 'Data'});

        const refreshRow = new Adw.SpinRow({
            title: 'Refresh Interval',
            subtitle: 'How often to check usage (seconds)',
            adjustment: new Gtk.Adjustment({
                lower: 60, upper: 3600,
                step_increment: 30, page_increment: 300,
                value: settings.get_int('refresh-interval'),
            }),
        });
        settings.bind('refresh-interval', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dataGroup.add(refreshRow);

        const resumeRow = new Adw.SwitchRow({
            title: 'Fetch on Resume',
            subtitle: 'Auto-refresh when waking from suspend',
        });
        settings.bind('retry-on-resume', resumeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        dataGroup.add(resumeRow);

        page.add(dataGroup);

        // Panel placement
        const placeGroup = new Adw.PreferencesGroup({title: 'Panel Placement'});

        const posModel = new Gtk.StringList();
        posModel.append('Left');
        posModel.append('Center');
        posModel.append('Right');
        const posValues = ['left', 'center', 'right'];

        const posRow = new Adw.ComboRow({
            title: 'Panel Position',
            subtitle: 'Which box in the top bar',
            model: posModel,
        });
        posRow.set_selected(posValues.indexOf(settings.get_string('panel-position')));
        posRow.connect('notify::selected', () => {
            settings.set_string('panel-position', posValues[posRow.get_selected()]);
        });
        placeGroup.add(posRow);

        const indexRow = new Adw.SpinRow({
            title: 'Panel Index',
            subtitle: 'Position within the box (0 = leftmost)',
            adjustment: new Gtk.Adjustment({
                lower: 0, upper: 20,
                step_increment: 1, page_increment: 5,
                value: settings.get_int('panel-index'),
            }),
        });
        settings.bind('panel-index', indexRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        placeGroup.add(indexRow);

        page.add(placeGroup);

        // Visibility
        const visGroup = new Adw.PreferencesGroup({title: 'Visibility'});

        for (const [key, title, subtitle] of [
            ['show-session', 'Show Session Limit', '5-hour session limit in panel and menu'],
            ['show-weekly', 'Show Weekly Limit', '7-day weekly limit in panel and menu'],
            ['show-model-breakdown', 'Show Model Breakdown', 'Per-model (Opus/Sonnet) rows in menu'],
            ['show-tooltip', 'Show Tooltip', 'Reset times on hover'],
            ['show-reset-timers', 'Show Reset Timers', '"Resets in\u2026" rows in menu'],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            visGroup.add(row);
        }

        page.add(visGroup);
        window.add(page);
    }

    // ── Appearance ────────────────────────────────────────────────

    _addAppearancePage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic',
        });

        // Style
        const styleGroup = new Adw.PreferencesGroup({
            title: 'Panel Style',
            description: 'Text format tokens: {s} session %, {w} weekly %, {sr} session reset, {wr} weekly reset',
        });

        const styleModel = new Gtk.StringList();
        styleModel.append('Text (S:37% W:26%)');
        styleModel.append('Minimal (progress bars)');
        const styleValues = ['text', 'minimal'];

        const styleRow = new Adw.ComboRow({
            title: 'Panel Style',
            subtitle: 'How the indicator looks in the top bar',
            model: styleModel,
        });
        styleRow.set_selected(styleValues.indexOf(settings.get_string('panel-style')));
        styleRow.connect('notify::selected', () => {
            settings.set_string('panel-style', styleValues[styleRow.get_selected()]);
        });
        styleGroup.add(styleRow);

        const textFmtRow = new Adw.EntryRow({title: 'Text Format'});
        textFmtRow.set_text(settings.get_string('text-format'));
        textFmtRow.connect('changed', () => {
            settings.set_string('text-format', textFmtRow.get_text());
        });
        styleGroup.add(textFmtRow);

        page.add(styleGroup);

        // Colors
        const colorGroup = new Adw.PreferencesGroup({title: 'Colors'});

        const barColorRow = new Adw.SwitchRow({
            title: 'Colored Indicators',
            subtitle: 'Use threshold colors (otherwise white)',
        });
        settings.bind('bar-colored', barColorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        colorGroup.add(barColorRow);

        const warnRow = new Adw.SpinRow({
            title: 'Warning Threshold',
            subtitle: 'Usage % where color switches to warning',
            adjustment: new Gtk.Adjustment({
                lower: 10, upper: 100,
                step_increment: 5, page_increment: 10,
                value: settings.get_int('threshold-warning'),
            }),
        });
        settings.bind('threshold-warning', warnRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        colorGroup.add(warnRow);

        const critRow = new Adw.SpinRow({
            title: 'Critical Threshold',
            subtitle: 'Usage % where color switches to critical',
            adjustment: new Gtk.Adjustment({
                lower: 10, upper: 100,
                step_increment: 5, page_increment: 10,
                value: settings.get_int('threshold-critical'),
            }),
        });
        settings.bind('threshold-critical', critRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        colorGroup.add(critRow);

        for (const [key, title] of [
            ['color-normal', 'Normal Color'],
            ['color-warning', 'Warning Color'],
            ['color-critical', 'Critical Color'],
        ]) {
            const row = new Adw.EntryRow({title});
            row.set_text(settings.get_string(key));
            row.connect('changed', () => {
                settings.set_string(key, row.get_text());
            });
            colorGroup.add(row);
        }

        page.add(colorGroup);

        // Bar geometry
        const barGroup = new Adw.PreferencesGroup({title: 'Bar Geometry (Minimal Mode)'});

        for (const [key, title, subtitle, lower, upper, step] of [
            ['bar-width', 'Bar Width', 'Track width in pixels', 8, 128, 4],
            ['bar-height', 'Bar Height', 'Track height in pixels', 2, 32, 1],
            ['bar-radius', 'Bar Radius', 'Border radius in pixels', 0, 16, 1],
            ['bar-spacing', 'Bar Spacing', 'Gap between bars in pixels', 0, 16, 1],
        ]) {
            const row = new Adw.SpinRow({
                title, subtitle,
                adjustment: new Gtk.Adjustment({
                    lower, upper,
                    step_increment: step, page_increment: step * 5,
                    value: settings.get_int(key),
                }),
            });
            settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
            barGroup.add(row);
        }

        const trackColorRow = new Adw.EntryRow({title: 'Track Color'});
        trackColorRow.set_text(settings.get_string('bar-track-color'));
        trackColorRow.connect('changed', () => {
            settings.set_string('bar-track-color', trackColorRow.get_text());
        });
        barGroup.add(trackColorRow);

        page.add(barGroup);

        // Stale
        const staleGroup = new Adw.PreferencesGroup({title: 'Stale Data'});

        const staleRow = new Adw.SpinRow({
            title: 'Stale Opacity',
            subtitle: 'Opacity when showing cached data (0.0 \u2013 1.0)',
            digits: 1,
            adjustment: new Gtk.Adjustment({
                lower: 0.0, upper: 1.0,
                step_increment: 0.1, page_increment: 0.25,
                value: settings.get_double('stale-opacity'),
            }),
        });
        settings.bind('stale-opacity', staleRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        staleGroup.add(staleRow);

        page.add(staleGroup);
        window.add(page);
    }

    // ── Notifications ─────────────────────────────────────────────

    _addNotificationsPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: 'Notifications',
            icon_name: 'preferences-system-notifications-symbolic',
        });

        const group = new Adw.PreferencesGroup({title: 'Desktop Notifications'});

        const enabledRow = new Adw.SwitchRow({
            title: 'Enable Notifications',
            subtitle: 'Notify when usage exceeds threshold',
        });
        settings.bind('notifications-enabled', enabledRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(enabledRow);

        const threshRow = new Adw.SpinRow({
            title: 'Threshold',
            subtitle: 'Usage % that triggers a notification',
            adjustment: new Gtk.Adjustment({
                lower: 10, upper: 100,
                step_increment: 5, page_increment: 10,
                value: settings.get_int('notification-threshold'),
            }),
        });
        settings.bind('notification-threshold', threshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(threshRow);

        const cooldownRow = new Adw.SpinRow({
            title: 'Cooldown',
            subtitle: 'Seconds before re-notifying for the same window',
            adjustment: new Gtk.Adjustment({
                lower: 60, upper: 3600,
                step_increment: 30, page_increment: 300,
                value: settings.get_int('notification-cooldown'),
            }),
        });
        settings.bind('notification-cooldown', cooldownRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(cooldownRow);

        page.add(group);
        window.add(page);
    }

    // ── About ─────────────────────────────────────────────────────

    _addAboutPage(window) {
        const page = new Adw.PreferencesPage({
            title: 'About',
            icon_name: 'help-about-symbolic',
        });

        const aboutGroup = new Adw.PreferencesGroup({
            title: 'Claude Code Limits',
            description: 'Shows Claude Code session and weekly usage limits in the GNOME top bar.',
        });

        const versionRow = new Adw.ActionRow({
            title: 'Version',
            subtitle: `${this.metadata.version ?? 1}`,
        });
        aboutGroup.add(versionRow);

        if (this.metadata.url) {
            const urlRow = new Adw.ActionRow({
                title: 'Homepage',
                subtitle: this.metadata.url,
            });
            aboutGroup.add(urlRow);
        }

        page.add(aboutGroup);

        // Auth
        const authGroup = new Adw.PreferencesGroup({
            title: 'Authentication',
            description: 'This extension reads your OAuth token from ~/.claude/.credentials.json created by the Claude Code CLI.\n\nIf you see "Not logged in", run `claude` in a terminal and complete the login flow.',
        });

        const credPath = GLib.build_filenamev([GLib.get_home_dir(), '.claude', '.credentials.json']);
        const credExists = GLib.file_test(credPath, GLib.FileTest.EXISTS);

        const statusRow = new Adw.ActionRow({
            title: 'Credentials File',
            subtitle: credExists ? 'Found' : 'Not found \u2014 run `claude` to log in',
        });
        authGroup.add(statusRow);

        page.add(authGroup);
        window.add(page);
    }
}
