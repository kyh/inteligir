// Remote-access section of the settings panel (jsdom): the toggle surfaces a
// bridge failure as the section's inline error (instead of an unhandled
// rejection with no feedback), and the plaintext-LAN caveat caption renders.
// Runs the real SettingsPanel over the dev-harness fixture Bridge, with the
// one method under test overridden per case.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// No vitest globals in this repo, so testing-library can't auto-cleanup.
afterEach(cleanup);

// jsdom has no matchMedia; ThemeProvider needs it for OS-preference tracking.
vi.stubGlobal(
  "matchMedia",
  (media: string): MediaQueryList => ({
    matches: false,
    media,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
);

import type { Bridge } from "@repo/bridge/ipc-registry";
import { createSqlKnowledgeStore } from "@repo/domain/knowledge/sql-knowledge-store";
import { ThemeProvider } from "@repo/ui/lib/theme";
import { createFixtureBridge } from "../../../dev/fixture-bridge";
import { createWasmSqlDriver, loadSqlite3 } from "../../../dev/wasm-sql-driver";
import { installBridge } from "@renderer/lib/bridge";
import { VaultProvider } from "@renderer/workspace/vault-context";
import { SettingsPanel } from "./settings-panel";

// The fixture bridge takes the harness's injected knowledge store (wasm SQL).
const sqlite3 = await loadSqlite3();
const newBridge = () =>
  createFixtureBridge((root) => createSqlKnowledgeStore(createWasmSqlDriver(sqlite3), root));

function renderPanel(bridge: Bridge) {
  installBridge(bridge);
  return render(
    <ThemeProvider theme="light" setTheme={() => {}}>
      <VaultProvider>
        <SettingsPanel />
      </VaultProvider>
    </ThemeProvider>,
  );
}

describe("RemoteAccessSection", () => {
  it("shows an inline error when the toggle's bridge call rejects", async () => {
    const bridge: Bridge = {
      ...newBridge(),
      setRemoteAccessConfig: () => Promise.reject(new Error("rebind interrupted")),
    };
    renderPanel(bridge);

    const toggle = await screen.findByRole("switch", { name: "Allow other devices" });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getByText("Failed to update remote access.")).toBeTruthy();
    });
  });

  it("renders the unencrypted-network caveat under the toggle", async () => {
    renderPanel(newBridge());
    await screen.findByRole("switch", { name: "Allow other devices" });
    expect(screen.getByText(/Connections on your local network are unencrypted\./)).toBeTruthy();
  });
});
