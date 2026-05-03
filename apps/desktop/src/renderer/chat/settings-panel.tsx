import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Checkbox } from "@repo/ui/components/checkbox";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";
import type { NotificationSettings } from "@/shared/ipc";

export function SettingsPanel() {
  const appState = useAgentStore((s) => s.appState);
  const newSession = useAgentStore((s) => s.newSession);
  const isReady = appState.phase === "ready";
  const canStartNewSession = isReady && appState.agent === "idle";

  const [notifications, setNotifications] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    const promise = getBridge()?.getNotificationSettings();
    if (!promise) return;
    void promise.then(setNotifications).catch(() => {});
  }, []);

  const handleLogout = useCallback(() => {
    getBridge()?.transition({ type: "LOGOUT" });
  }, []);

  const handleNewSession = useCallback(() => {
    void newSession();
  }, [newSession]);

  const toggleNotifications = useCallback(async (next: boolean) => {
    const updated = await getBridge()?.updateNotificationSettings({
      enabled: next,
    });
    if (updated) setNotifications(updated);
  }, []);

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground">OpenAI Account</Label>
        {isReady ? (
          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
            <span className="text-xs text-foreground">Connected</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              Log out
            </Button>
          </div>
        ) : (
          <div className="rounded-md border border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">Not connected</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground">Session</Label>
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <span className="flex flex-col">
            <span className="text-xs text-foreground">Start new session</span>
            <span className="text-[10px] text-muted-foreground">
              Replaces the current session. Chat history is cleared.
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewSession}
            disabled={!canStartNewSession}
            className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            New session
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground">Notifications</Label>
        <label className="flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2">
          <span className="flex flex-col">
            <span className="text-xs text-foreground">Notify when idle</span>
            <span className="text-[10px] text-muted-foreground">
              Show an OS notification when the agent finishes a turn while Inteligir is in the
              background.
            </span>
          </span>
          <Checkbox
            checked={notifications?.enabled === true}
            onCheckedChange={(checked) => {
              void toggleNotifications(checked === true);
            }}
            disabled={notifications === null}
          />
        </label>
      </div>
    </div>
  );
}
