import { SettingsSchema, type OAuthCredentials, type Settings } from "@/shared/settings";
import { refreshToken } from "@/main/auth/openai-auth";
import { inteligirPath, readJson, writeJson } from "@/main/lib/json-store";

// ---------------------------------------------------------------------------
// File-based settings CRUD — ~/.inteligir/settings.json
// ---------------------------------------------------------------------------

const SETTINGS_PATH = inteligirPath("settings.json");

const DEFAULT_SETTINGS: Settings = {};

export function getSettings(): Settings {
  return readJson(SETTINGS_PATH, SettingsSchema) ?? DEFAULT_SETTINGS;
}

export function saveSettings(settings: Settings): void {
  writeJson(SETTINGS_PATH, settings);
}

export function saveOAuthCredentials(creds: OAuthCredentials): void {
  const settings = getSettings();
  saveSettings({ ...settings, oauthCredentials: creds });
}

export function isLoggedIn(): boolean {
  return Boolean(getSettings().oauthCredentials);
}

// ---------------------------------------------------------------------------
// OAuth token resolution with auto-refresh
// ---------------------------------------------------------------------------

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

let refreshPromise: Promise<string> | null = null;

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
