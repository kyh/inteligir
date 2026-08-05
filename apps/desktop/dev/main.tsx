import { createRoot } from "react-dom/client";

import { createSqlKnowledgeStore } from "@repo/notes/knowledge/sql-knowledge-store";
import { App } from "@repo/workspace/app-root";
import { installBridge } from "@repo/bridge/client";
import { setHtmlAppRuntime } from "@repo/workspace/workspace/html-app-host";

import { injectHtmlAppRuntime } from "../src/html-app-inject";

import { createFixtureBridge } from "@repo/workspace/dev/fixture-bridge";
import { createWasmSqlDriver, loadSqlite3 } from "@repo/workspace/dev/wasm-sql-driver";

// The one async step: load the SQLite wasm module before the Bridge exists.
// Everything downstream (the driver, the store) is synchronous.
const sqlite3 = await loadSqlite3();

installBridge(
  createFixtureBridge((root) => createSqlKnowledgeStore(createWasmSqlDriver(sqlite3), root)),
);

// No protocol in a plain browser — the view assembles a blob: URL instead.
setHtmlAppRuntime({ protocolUrl: null, injectRuntime: injectHtmlAppRuntime });

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
