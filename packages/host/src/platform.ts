// ---------------------------------------------------------------------------
// HostPlatform — the capability port a shell injects into createHost().
// Everything the host needs from its surroundings that is not plain node
// (native dialogs, OS keychain, notifications, packaged-resource locations)
// crosses this seam, so the host library itself never imports electron.
// ---------------------------------------------------------------------------

/** Which non-plaintext entry kind a cipher produces in secrets.json. Entries
 * written by one cipher kind are unreadable by the other by design — a
 * cross-mode read degrades to "not configured", never a store quarantine. */
export type SecretCipherKind = "safe-storage" | "file-key";

/** Encryption seam for the secret store. Electron: safeStorage (OS keychain).
 * Server: file-key AES-GCM (lib/file-key-cipher.ts). Tests inject fakes. */
export type SecretCipher = {
  kind: SecretCipherKind;
  isAvailable: () => boolean;
  /** Plaintext → base64 ciphertext. */
  encrypt: (plaintext: string) => string;
  /** Base64 ciphertext → plaintext. Throws when the payload can't be read
   * (keychain reset, different machine, missing key file). */
  decrypt: (data: string) => string;
};

export type HostNotification = {
  title: string;
  body: string;
  /** Invoked when the user activates the notification (focus the UI). */
  onActivate?: () => void;
};

export type HostPlatform = {
  /**
   * Per-user data dir for large mutable assets that must survive logout
   * (voice models today). NOT ~/.inteligir — logout rm -rf's that.
   * Electron: app.getPath("userData"). Server: an env-paths style data dir.
   */
  userDataDir: string;

  /**
   * Directory holding bundled agent resources (skills/, AGENTS.md).
   * Electron packaged: <resources>/agent; dev + server: the repo/package's
   * packages/host/resources/agent. Injecting the resolved path removes the
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

  /**
   * Native directory picker for the vault chooser. OPTIONAL — server mode
   * picks the vault at boot and has no native dialog; when absent the
   * chooseVaultRoot handler reports the location as fixed and the UI hides
   * the affordance (Host.capabilities.canPickVault).
   */
  pickDirectory?: (opts: { title: string; defaultPath: string }) => Promise<string | null>;

  /** OS-level notification. Electron: Notification + focus-window activate.
   * Server: no-op until browser-side notifications ride the Bridge. */
  notify: (notification: HostNotification) => void;

  /** True when any app UI is foreground — suppresses agent-idle
   * notifications. Server: false (always notify). */
  anyUiFocused: () => boolean;
};

export type HostOptions = {
  /** Bundled Google OAuth "Desktop app" client. The desktop shell passes its
   * build-define values; server/cli rely on the runtime
   * INTELIGIR_GOOGLE_OAUTH_CLIENT_* env fallback. Absent → the
   * paste-your-own-GCP-app dialog flow (unchanged). */
  bundledGoogleClient?: { clientId: string; clientSecret: string };
  /** Mirror console to ~/.inteligir/logs/agent.log (default true). */
  agentLog?: boolean;
};
