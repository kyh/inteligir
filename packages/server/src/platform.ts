// ---------------------------------------------------------------------------
// HostPlatform — the capability port a shell injects into createHost().
// Everything the host needs from its surroundings that is not plain node
// (native dialogs, OS keychain, notifications, packaged-resource locations)
// crosses this seam, so the host library itself never imports electron.
// ---------------------------------------------------------------------------

import type { SecretCipher } from "@repo/storage/secrets";

export type HostNotification = {
  title: string;
  body: string;
  /** Invoked when the user activates the notification (focus the UI). */
  onActivate?: () => void;
};

export type HostPlatform = {
  /**
   * True in a packaged production install (Electron: app.isPackaged), false
   * in dev checkouts and test shells. Gates the dev-only env flags
   * (@repo/bridge/dev-flags): a packaged build refuses INTELIGIR_FAUX_AGENT /
   * INTELIGIR_EMULATE_CONNECTORS outright.
   */
  isPackaged: boolean;

  /**
   * Per-user data dir for large mutable assets that must survive logout
   * (voice models today). NOT ~/.inteligir — logout rm -rf's that.
   * Electron: app.getPath("userData"). Server: an env-paths style data dir.
   */
  userDataDir: string;

  /**
   * Directory holding bundled agent resources (skills/, AGENTS.md).
   * Electron packaged: <resources>/agent; dev: the repo's
   * packages/agent/resources/agent. Injecting the resolved path removes the
   * host's app.isPackaged / process.resourcesPath branches.
   */
  resourcesDir: string;

  /**
   * Whether a missing resourcesDir is fatal (packaged install = corrupt) or
   * a warn-and-continue (dev checkout). Replaces app.isPackaged in
   * agent/setup.ts.
   */
  strictResources: boolean;

  /** Secret-at-rest encryption for ~/.inteligir/secrets.json. */
  secretCipher: SecretCipher;

  /** Open a URL in the user's default browser (OAuth consent, links). */
  openExternal: (url: string) => Promise<void>;

  /** Move a file to the OS trash (user-initiated note deletes — recoverable
   * through the OS trash UI, no in-app trash view). Throws when the platform
   * has no trash implementation (some Linux configurations) — VaultManager
   * falls back to a permanent remove. Required, not optional: an optional
   * capability invites silent no-op shells. */
  trashItem: (absolutePath: string) => Promise<void>;

  /** Native directory picker for the vault chooser. */
  pickDirectory: (opts: { title: string; defaultPath: string }) => Promise<string | null>;

  /** OS-level notification. Electron: Notification + focus-window activate. */
  notify: (notification: HostNotification) => void;

  /** True when any app UI is foreground — suppresses agent-idle
   * notifications. */
  anyUiFocused: () => boolean;
};

export type HostOptions = {
  /** Bundled Google OAuth "Desktop app" client. The desktop shell passes its
   * build-define values; absent → the runtime INTELIGIR_GOOGLE_OAUTH_CLIENT_*
   * env fallback, then the paste-your-own-GCP-app dialog flow. */
  bundledGoogleClient?: { clientId: string; clientSecret: string };
};
