// The bridge carries what the page cannot ask its server: the loopback origin
// (a browser WebSocket cannot set a header and dials a different origin than
// the page, so main hands it over and attaches the bearer to the upgrade
// itself), and what lives in main: the updater, the spell checker, the vault
// switch, Reveal/Open and the diagnostics. Everything else rides the protocol
// handler, so the renderer never holds the token. Each channel is one row in
// ipc-contract.ts. The first-run window has a bridge of its own, below.

import type { DiagnosticsAnswer, DiagnosticsState } from "./diagnostics-state";
import type {
  FirstRunAnswer,
  FirstRunChoice,
  FirstRunState,
  PickFolderAnswer,
  PickParentAnswer,
} from "./first-run-state";
import type { PathActionResult } from "./path-action";
import type { SpellcheckChoice, SpellcheckState } from "./spellcheck-state";
import type { UpdateState } from "./update-state";
import type { VaultSwitchAnswer, VaultsState } from "./vaults-state";

// the preload parses every frame against update-state.ts before it reaches the page
export interface DesktopUpdatesBridge {
  getState: () => Promise<UpdateState>;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => Promise<UpdateState>;
  onState: (listener: (state: UpdateState) => void) => () => void;
}

// the spell checker is the window session's, so only main can switch it; the page keeps the choice
export interface DesktopSpellcheckBridge {
  getState: () => Promise<SpellcheckState>;
  apply: (choice: SpellcheckChoice) => Promise<SpellcheckState>;
}

// the OS reaches a vault entry through main alone, which resolves and checks the path itself
export interface DesktopPathsBridge {
  reveal: (path: string) => Promise<PathActionResult>;
  open: (path: string) => Promise<PathActionResult>;
}

// the vault is the server's, so a switch restarts the child and replaces this window: `pick`
// and `open` answer only when nothing changed (a cancelled picker, a refusal)
export interface DesktopVaultsBridge {
  getState: () => Promise<VaultsState>;
  pick: () => Promise<VaultSwitchAnswer>;
  open: (path: string) => Promise<VaultSwitchAnswer>;
  forget: (path: string) => Promise<VaultsState>;
}

// main forks the server, so only main can hand it the debug choice, restart it, or show the log
// it writes and the data folder it lives in
export interface DesktopDiagnosticsBridge {
  getState: () => Promise<DiagnosticsState>;
  setDebug: (debug: boolean) => Promise<DiagnosticsAnswer>;
  restart: () => Promise<DiagnosticsAnswer>;
  openDataFolder: () => Promise<PathActionResult>;
  showLog: () => Promise<PathActionResult>;
}

export interface DesktopBridge {
  socketOrigin: string;
  diagnostics: DesktopDiagnosticsBridge;
  updates: DesktopUpdatesBridge;
  spellcheck: DesktopSpellcheckBridge;
  paths: DesktopPathsBridge;
  vaults: DesktopVaultsBridge;
}

// the first-run window's whole bridge, on its own preload: before the first boot there is no
// server, so the page asks main for the vault choice and nothing else. The folders it names are
// ones main handed out, and `finish` answers only when no vault opened
export interface FirstRunBridge {
  getState: () => Promise<FirstRunState>;
  pickParent: () => Promise<PickParentAnswer>;
  pickFolder: () => Promise<PickFolderAnswer>;
  finish: (choice: FirstRunChoice) => Promise<FirstRunAnswer>;
}

export const toErrorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
