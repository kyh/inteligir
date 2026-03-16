import { useCallback } from "react";
import { useNavigate } from "react-router";

import { Button } from "@repo/ui/button";
import { Label } from "@repo/ui/label";

import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";

export function SettingsPage() {
  const navigate = useNavigate();
  const appState = useAgentStore((s) => s.appState);
  const clearMessages = useAgentStore((s) => s.clearMessages);

  const isReady = appState.phase === "ready";

  const goBack = useCallback(() => {
    void navigate("/");
  }, [navigate]);

  const handleLogout = useCallback(() => {
    clearMessages();
    getBridge()?.transition({ type: "LOGOUT" });
  }, [clearMessages]);

  return (
    <div className="flex flex-1 flex-col px-6 pb-6 pt-12">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto">
        <div>
          <h1 className="text-sm font-semibold">Settings</h1>
          <p className="text-[10px] text-muted-foreground">
            Configure your AI chief of staff.
          </p>
        </div>

        {/* OpenAI account */}
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium text-muted-foreground">
            OpenAI Account
          </Label>
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
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">Not connected</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 justify-end gap-2 pt-4">
        <Button variant="outline" onClick={goBack} className="text-xs">
          Back
        </Button>
      </div>
    </div>
  );
}
