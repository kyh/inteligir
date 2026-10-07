// What the page asks the shell rather than its server: the updater, printing, the vault switch,
// Reveal/Open and the diagnostics, because no server can answer for any of them. Each call is one
// command row in ipc-contract.ts. The first-run window has a bridge of its own, below.

import type { DiagnosticsAnswer, DiagnosticsState } from "./diagnostics-state";
import type {
  FirstRunAnswer,
  FirstRunChoice,
  FirstRunState,
  PickFolderAnswer,
  PickParentAnswer,
} from "./first-run-state";
import type { PathActionResult } from "./path-action";
import type { UpdateState } from "./update-state";
import type { VaultSwitchAnswer, VaultsState } from "./vaults-state";

// the shell reduces the updater's state and pushes every move; the page parses each frame
export interface DesktopUpdatesBridge {
  getState: () => Promise<UpdateState>;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => Promise<UpdateState>;
  onState: (listener: (state: UpdateState) => void) => () => void;
}

// the OS reaches a vault entry through the shell alone, which resolves and checks the path itself
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

// the shell starts the server, so only it can hand it the debug choice, restart it, or show the
// log it writes and the data folder it lives in
export interface DesktopDiagnosticsBridge {
  getState: () => Promise<DiagnosticsState>;
  setDebug: (debug: boolean) => Promise<DiagnosticsAnswer>;
  restart: () => Promise<DiagnosticsAnswer>;
  openDataFolder: () => Promise<PathActionResult>;
  showLog: () => Promise<PathActionResult>;
}

export interface DesktopBridge {
  diagnostics: DesktopDiagnosticsBridge;
  updates: DesktopUpdatesBridge;
  paths: DesktopPathsBridge;
  // the print panel, as a sheet over the window: WKWebView answers no `window.print()`
  print: () => Promise<PathActionResult>;
  vaults: DesktopVaultsBridge;
}

// the first-run window's whole bridge: before the first boot there is no server, so the page asks
// the shell for the vault choice and nothing else. The folders it names are ones the shell handed
// out, and `finish` answers only when no vault opened
export interface FirstRunBridge {
  getState: () => Promise<FirstRunState>;
  pickParent: () => Promise<PickParentAnswer>;
  pickFolder: () => Promise<PickFolderAnswer>;
  finish: (choice: FirstRunChoice) => Promise<FirstRunAnswer>;
}
