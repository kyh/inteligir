// Every arm of the desktop bridge, answering from memory: a DOM suite that needs the bridge
// merely present installs this and spreads its own over the one arm it asserts on.

import type { DiagnosticsState } from "../../../diagnostics-state";
import type { DesktopBridge } from "../../../types";
import { initialUpdateState } from "../../../update-state";

const inertUpdates = initialUpdateState("0.0.0", "a test stub");

const inertVaults = {
  blocked: null,
  current: { name: "Inteligir", path: "/home/me/Inteligir" },
  recent: [],
};

const inertSpellcheck = {
  available: [],
  enabled: true,
  languages: [],
  languagesConfigurable: false,
};

const inertDiagnostics: DiagnosticsState = {
  canRestart: false,
  debug: false,
  restartRequired: false,
  server: "owned",
};

export const inertBridge = (): DesktopBridge => ({
  diagnostics: {
    getState: async () => inertDiagnostics,
    openDataFolder: async () => ({ ok: true }),
    restart: async () => ({ ok: true, state: inertDiagnostics }),
    setDebug: async () => ({ ok: true, state: inertDiagnostics }),
    showLog: async () => ({ ok: true }),
  },
  paths: {
    open: async () => ({ ok: true }),
    reveal: async () => ({ ok: true }),
  },
  socketOrigin: "http://127.0.0.1:1",
  spellcheck: {
    apply: async () => inertSpellcheck,
    getState: async () => inertSpellcheck,
  },
  updates: {
    check: async () => inertUpdates,
    download: async () => inertUpdates,
    getState: async () => inertUpdates,
    install: async () => inertUpdates,
    onState: () => () => {},
  },
  vaults: {
    forget: async () => inertVaults,
    getState: async () => inertVaults,
    open: async () => ({ ok: true, state: inertVaults }),
    pick: async () => ({ ok: true, state: inertVaults }),
  },
});
