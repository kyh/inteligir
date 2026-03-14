import { useCallback, useEffect, useState } from "react";

import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Label } from "@repo/ui/label";
import { Textarea } from "@repo/ui/textarea";

import { useAgentStore } from "./stores/agent-store";
import { getBridge } from "./bridge";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const needsSetup = useAgentStore((s) => s.needsSetup);
  const [loggedIn, setLoggedIn] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const bridge = getBridge();
    if (!bridge) return;
    void bridge
      .getSettings()
      .then((settings) => {
        setLoggedIn(settings.loggedIn);
        setSystemPrompt(settings.systemPrompt ?? "");
      })
      .catch(() => {});
  }, [open]);

  const handleLogin = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    setLoggingIn(true);
    setLoginError(null);

    void bridge
      .login()
      .then((result) => {
        if (result.ok) {
          setLoggedIn(true);
          useAgentStore.getState().checkSetup();
          useAgentStore.getState().fetchState();
          if (needsSetup) onOpenChange(false);
        } else {
          setLoginError(result.error);
        }
      })
      .catch(() => setLoginError("Login failed"))
      .finally(() => setLoggingIn(false));
  }, [needsSetup, onOpenChange]);

  const handleLogout = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge.logout().then(() => {
      setLoggedIn(false);
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
        onOpenChange(false);
        useAgentStore.getState().fetchState();
      })
      .catch(() => {})
      .finally(() => setSaving(false));
  }, [systemPrompt, onOpenChange]);

  // Onboarding
  if (needsSetup) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm font-mono" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Welcome to Inteligir</DialogTitle>
            <DialogDescription>
              Log in with your OpenAI account to get started.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-2">
            <Button
              onClick={handleLogin}
              disabled={loggingIn}
              className="w-full text-xs"
            >
              {loggingIn ? "Waiting for browser..." : "Log in with OpenAI"}
            </Button>
            {loginError && (
              <p className="text-[10px] text-destructive">{loginError}</p>
            )}
            <p className="text-[10px] text-muted-foreground/60">
              Opens your browser to sign in with OpenAI.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md font-mono">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your AI chief of staff.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto py-2">
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
                onClick={handleLogin}
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

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="text-xs">
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
