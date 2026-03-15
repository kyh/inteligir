import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { Button } from "@repo/ui/button";
import { Label } from "@repo/ui/label";
import { Textarea } from "@repo/ui/textarea";

import { getBridge } from "@/renderer/lib/bridge";
import { useLogin } from "@/renderer/lib/use-login";
import { useAgentStore } from "@/renderer/stores/agent-store";

export function SettingsPage() {
  const navigate = useNavigate();
  const { login, loggingIn, loginError } = useLogin();
  const [loggedIn, setLoggedIn] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge
      .getSettings()
      .then((settings) => {
        setLoggedIn(settings.loggedIn);
        setSystemPrompt(settings.systemPrompt ?? "");
      })
      .catch(() => {});
  }, []);

  // Update local loggedIn state when login succeeds via hook
  const needsSetup = useAgentStore((s) => s.needsSetup);
  useEffect(() => {
    if (!needsSetup) setLoggedIn(true);
  }, [needsSetup]);

  const goBack = useCallback(() => {
    useAgentStore.getState().checkSetup();
    void navigate("/");
  }, [navigate]);

  const handleLogout = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.logout().then(() => {
      useAgentStore.getState().clearMessages();
      useAgentStore.getState().checkSetup();
    });
  }, []);

  const handleSave = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    setSaving(true);

    void bridge
      .setSettings({
        ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
      })
      .then(() => {
        useAgentStore.getState().fetchState();
        goBack();
      })
      .catch(() => {})
      .finally(() => setSaving(false));
  }, [systemPrompt, goBack]);

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
          {loggedIn ? (
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
            <Button
              variant="outline"
              onClick={login}
              disabled={loggingIn}
              className="text-xs"
            >
              {loggingIn ? "Waiting for browser..." : "Log in with OpenAI"}
            </Button>
          )}
          {loginError && (
            <p className="text-[10px] text-destructive">{loginError}</p>
          )}
        </div>

        {/* System prompt */}
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium text-muted-foreground">
            System prompt
          </Label>
          <Textarea
            placeholder="You are my AI chief of staff..."
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="min-h-[80px] text-xs"
            rows={4}
          />
          <p className="text-[10px] text-muted-foreground/60">
            Instructions prepended to every conversation.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 justify-end gap-2 pt-4">
        <Button variant="outline" onClick={goBack} className="text-xs">
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving} className="text-xs">
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
