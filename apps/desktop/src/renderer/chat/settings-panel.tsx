import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStateStore, type Spec, type StateStore } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@/renderer/lib/bridge";
import { settingsRegistry } from "@/renderer/chat/settings-registry";
import { useAgentStore } from "@/renderer/stores/agent-store";
import type { UiSettingsConfig } from "@/shared/ui-settings";

// ---------------------------------------------------------------------------
// Settings panel — renders a JSON spec (loaded from disk, optionally rewritten
// by the LLM via the modify_ui_settings tool) through json-render. Action
// handlers translate emitted events into existing app bridges; the on-disk
// state file seeds two-way `$bindState` values. A "Reset" button below the
// renderer is always present as a safety net, regardless of what the spec
// contains.
// ---------------------------------------------------------------------------

export function SettingsPanel() {
  const appState = useAgentStore((s) => s.appState);
  const newSession = useAgentStore((s) => s.newSession);

  const isReady = appState.phase === "ready";
  const canStartSession = isReady && appState.agent === "idle";

  const [config, setConfig] = useState<UiSettingsConfig | null>(null);
  const [resetting, setResetting] = useState(false);

  // Seed the JSON state model once: persisted state from disk + live app
  // facts. Updates to those facts later are pushed into the store imperatively
  // (below) so the renderer keeps using the same store instance.
  const storeRef = useRef<StateStore | null>(null);
  const getStore = (): StateStore => {
    if (!storeRef.current) {
      storeRef.current = createStateStore({});
    }
    return storeRef.current;
  };

  // Subscribe first, then read. If a broadcast (LLM rewrite or reset) lands
  // between the read request and the response, the broadcast wins and the
  // stale initial-load snapshot is skipped — but we still seed the live
  // OS-level notification value, which the broadcast doesn't carry.
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    let cancelled = false;
    let broadcastSeen = false;
    const off = bridge.onUiSettingsUpdated((next) => {
      if (cancelled) return;
      broadcastSeen = true;
      getStore().update(mapToPointers(next.state));
      setConfig(next);
    });
    Promise.all([bridge.getUiSettings(), bridge.getNotificationSettings()])
      .then(([cfg, notif]) => {
        if (cancelled) return null;
        // Always seed the live OS-level notification value — broadcasts
        // don't carry it.
        getStore().update({ "/notifications/enabled": notif.enabled });
        // Only apply the on-disk snapshot if no fresher broadcast has
        // already overtaken us.
        if (!broadcastSeen) {
          getStore().update(mapToPointers(cfg.state));
          setConfig(cfg);
        }
        return null;
      })
      .catch(() => null);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Keep app-fact paths in the store in sync with the agent store.
  useEffect(() => {
    getStore().update({
      "/app/connected": isReady,
      "/app/canStartSession": canStartSession,
    });
  }, [isReady, canStartSession]);

  const handlers = useMemo(
    () => ({
      logout: () => {
        getBridge()?.transition({ type: "LOGOUT" });
      },
      newSession: () => {
        void newSession();
      },
      setNotifications: async (params: Record<string, unknown>) => {
        const enabled = params["enabled"];
        if (typeof enabled !== "boolean") return;
        await getBridge()?.updateNotificationSettings({ enabled });
      },
      resetUiSettings: async () => {
        await handleReset();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [newSession],
  );

  const handleReset = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    setResetting(true);
    try {
      await bridge.resetUiSettings();
    } finally {
      setResetting(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-4 p-3">
      {config ? (
        <JSONUIProvider
          registry={settingsRegistry}
          store={getStore()}
          handlers={handlers}
        >
          <Renderer spec={config.spec as unknown as Spec} registry={settingsRegistry} />
        </JSONUIProvider>
      ) : (
        <div className="text-xs text-muted-foreground">Loading settings…</div>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <Label className="text-xs font-medium text-muted-foreground">Reset</Label>
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <span className="flex flex-col">
            <span className="text-xs text-foreground">Reset settings UI</span>
            <span className="text-[10px] text-muted-foreground">
              Restore the default settings layout. Your account and notification choice are kept.
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleReset()}
            disabled={resetting}
            className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Flatten a nested object into a `{ "/json/pointer": value }` map for
 * `StateStore.update`. Leaves arrays whole — only plain objects are walked.
 */
function mapToPointers(
  value: unknown,
  prefix = "",
  out: Record<string, unknown> = {},
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    if (prefix.length === 0) return out;
    out[prefix] = value;
    return out;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    mapToPointers(child, `${prefix}/${key}`, out);
  }
  return out;
}
