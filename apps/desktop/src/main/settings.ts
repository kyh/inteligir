import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { SettingsSchema, type OAuthCredentials, type Settings } from "../shared/settings";
import { refreshToken } from "./openai-auth";

// ---------------------------------------------------------------------------
// File-based settings CRUD — ~/.inteligir/settings.json
// ---------------------------------------------------------------------------

const SETTINGS_DIR = path.join(os.homedir(), ".inteligir");
const SETTINGS_PATH = path.join(SETTINGS_DIR, "settings.json");

const DEFAULT_SETTINGS: Settings = {};

let cachedSettings: Settings | null = null;

export function getSettings(): Settings {
  if (cachedSettings) return cachedSettings;
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    const result = SettingsSchema.safeParse(JSON.parse(raw));
    cachedSettings = result.success ? result.data : DEFAULT_SETTINGS;
    return cachedSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings): void {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf8");
  cachedSettings = settings;
}

export function saveOAuthCredentials(creds: OAuthCredentials): void {
  const settings = getSettings();
  saveSettings({ ...settings, oauthCredentials: creds });
}

export function clearOAuthCredentials(): void {
  const settings = getSettings();
  const { oauthCredentials: _, ...rest } = settings;
  saveSettings(rest);
}

export function isLoggedIn(): boolean {
  return Boolean(getSettings().oauthCredentials);
}

// ---------------------------------------------------------------------------
// OAuth token resolution with auto-refresh
// ---------------------------------------------------------------------------

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

let refreshPromise: Promise<string> | null = null;

/**
 * Returns the current OAuth access token. Kicks off a background refresh
 * if the token is near expiry. Returns undefined if not logged in.
 */
export function resolveAccessToken(): string | undefined {
  const creds = getSettings().oauthCredentials;
  if (!creds) return undefined;

  const needsRefresh = Date.now() > creds.expires - REFRESH_BUFFER_MS;

  if (needsRefresh && !refreshPromise) {
    refreshPromise = refreshToken(creds.refresh)
      .then((newCreds) => {
        saveOAuthCredentials({
          access: newCreds.access,
          refresh: newCreds.refresh,
          expires: newCreds.expires,
        });
        refreshPromise = null;
        return newCreds.access;
      })
      .catch(() => {
        refreshPromise = null;
        return creds.access;
      });
  }

  return creds.access;
}
