// What the page asks the shell rather than its server: the updater and the diagnostics, because no
// server can answer for either. Each call is one command row in ipc-contract.ts.

import type { DiagnosticsAnswer, DiagnosticsState } from "./diagnostics-state";
import type { PathActionResult } from "./path-action";
import type { UpdateState } from "./update-state";

// the shell reduces the updater's state and pushes every move; the page parses each frame
export interface DesktopUpdatesBridge {
  getState: () => Promise<UpdateState>;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => Promise<UpdateState>;
  onState: (listener: (state: UpdateState) => void) => () => void;
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
}
