import { createRoot } from "react-dom/client";

import { createSqlKnowledgeStore } from "@repo/domain/knowledge/sql-knowledge-store";
import { App } from "@renderer/app-root";
import { installBridge } from "@renderer/lib/bridge";

import { createFixtureBridge } from "./fixture-bridge";
import { createWasmSqlDriver, loadSqlite3 } from "./wasm-sql-driver";

// The one async step: load the SQLite wasm module before the Bridge exists.
// Everything downstream (the driver, the store) is synchronous.
const sqlite3 = await loadSqlite3();

installBridge(
  createFixtureBridge((root) => createSqlKnowledgeStore(createWasmSqlDriver(sqlite3), root)),
);

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
