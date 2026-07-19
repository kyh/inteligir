// ---------------------------------------------------------------------------
// OS-level notifications when the agent finishes a turn while the UI is
// unfocused. Delivery goes through platform.notify / platform.anyUiFocused —
// this module owns only the enabled-setting store and message shaping.
// ---------------------------------------------------------------------------

import path from "node:path";
import { type Static, Type } from "@sinclair/typebox";

import { JsonStore, inteligirPath, type StoreRecoveryEvent } from "./storage/json-store";
import { getPlatform } from "./platform-instance";

// Deliberately unversioned store: a single boolean preference whose
// reset-to-default on mismatch is harmless (defaults to enabled).
const NotificationSettingsSchema = Type.Object(
  { enabled: Type.Boolean() },
  { additionalProperties: false },
);

export type NotificationSettings = Static<typeof NotificationSettingsSchema>;

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
};

export class NotificationsManager {
  private readonly store: JsonStore<NotificationSettings>;

  constructor(storePath?: string) {
    this.store = new JsonStore(
      storePath ?? inteligirPath("notifications.json"),
      NotificationSettingsSchema,
      DEFAULT_SETTINGS,
    );
  }

  getSettings(): NotificationSettings {
    return this.store.read();
  }

  /**
   * Drop the cached settings so the next `getSettings()` re-reads from disk.
   * Used after teardownResources() deletes ~/.inteligir/notifications.json so
   * we don't keep serving the pre-teardown cache.
   */
  invalidate(): void {
    this.store.invalidate();
  }

  updateSettings(patch: Partial<NotificationSettings>): NotificationSettings {
    // Don't blindly spread the patch — the IPC input type allows `enabled: undefined`,
    // which would overwrite the live setting and round-trip through the
    // schema's default on next read, silently resetting the user's choice.
    return this.store.update((current) => ({
      ...current,
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    }));
  }

  /**
   * Notify the user that the agent finished a turn. No-ops if disabled or if
   * any app UI has focus (platform.notify itself no-ops where the OS has no
   * notification support).
   *
   * `body` is truncated to a reasonable preview length — the agent's full
   * output is already visible inside the app.
   */
  notifyAgentIdle(body: string | undefined): void {
    if (!this.getSettings().enabled) return;
    const platform = getPlatform();
    if (platform.anyUiFocused()) return;

    const preview = body?.trim().slice(0, 180) ?? "Agent finished.";
    platform.notify({
      title: "Inteligir",
      body: preview.length > 0 ? preview : "Agent finished.",
    });
  }

  /**
   * Tell the user a JsonStore quarantined a data file. Deliberately bypasses
   * the `enabled` preference and the focus check that gate agent-idle
   * notifications — this event is rare, means data was set aside, and the
   * backup path shown here is the user's only pointer to recover it.
   */
  notifyStoreRecovered(event: StoreRecoveryEvent): void {
    const file = path.basename(event.filePath);
    const body =
      event.kind === "newer-version"
        ? `${file} was written by a newer version of Inteligir and was set aside. Backup: ${event.backupPath}`
        : `${file} could not be read and was reset. Backup: ${event.backupPath}`;
    getPlatform().notify({ title: "Inteligir — settings file recovered", body });
  }
}

let instance: NotificationsManager | null = null;

export function getNotifications(): NotificationsManager {
  if (!instance) instance = new NotificationsManager();
  return instance;
}

/**
 * Invalidate the singleton's JsonStore cache. Called from teardownResources()
 * so the next read goes back to disk after AGENT_DIR is wiped.
 */
export function resetNotifications(): void {
  instance?.invalidate();
}

// NOTE: the default JsonStore recovery notifier (quarantine notices) is wired
// in createHost(), explicitly — an import-time side effect here would vanish
// for any shell that never touches notifications.
