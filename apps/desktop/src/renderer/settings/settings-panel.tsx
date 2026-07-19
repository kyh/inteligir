import { useCallback, useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { confirm } from "@repo/ui/components/confirm-dialog";
import { Label } from "@repo/ui/components/label";

import { SegmentedControl } from "@renderer/components/segmented-control";
import { getBridge } from "@renderer/lib/bridge";
import { useTheme, type Theme } from "@renderer/lib/use-theme";
import { AccountSection } from "@renderer/settings/sections/account-section";
import { AiProviderSection } from "@renderer/settings/sections/ai-provider-section";
import { EditorAiSection } from "@renderer/settings/sections/editor-ai-section";
import { NotesSection } from "@renderer/settings/sections/notes-section";
import { RemoteAccessSection } from "@renderer/settings/sections/remote-access-section";
import { SettingSwitchRow } from "@renderer/settings/sections/setting-switch-row";
import { SyncSection } from "@renderer/settings/sections/sync-section";
import { VoiceSection } from "@renderer/settings/sections/voice-section";
import { useAgentStore } from "@renderer/stores/agent-store";
import type { NotificationSettings } from "@repo/bridge/ipc-registry";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

export function SettingsPanel({ onRequestClose }: { onRequestClose?: () => void }) {
  const appState = useAgentStore((s) => s.appState);
  const newSession = useAgentStore((s) => s.newSession);
  const resetAppData = useAgentStore((s) => s.resetAppData);
  const isReady = appState.phase === "ready";
  const canStartNewSession = isReady && appState.agent === "idle";

  const { theme, setTheme } = useTheme();
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null);

  useEffect(() => {
    void getBridge()
      .getNotificationSettings()
      .then(setNotifications)
      .catch(() => {});
  }, []);

  const handleNewSession = useCallback(() => {
    void newSession();
  }, [newSession]);

  const toggleNotifications = useCallback(async (next: boolean) => {
    setNotifications(
      await getBridge().updateNotificationSettings({
        enabled: next,
      }),
    );
  }, []);

  // The ONLY full teardown (#459 teardown decouple): provider disconnect and
  // account sign-out are independent actions in their own sections; this one
  // wipes ~/.inteligir (chat history, provider credentials, account session,
  // app settings) and re-runs setup. The vault — the user's notes — is
  // untouched: it lives outside ~/.inteligir by design.
  const handleResetAppData = useCallback(async () => {
    const confirmed = await confirm({
      title: "Reset app data?",
      body: "Chat history, AI provider connections, your account session, and app settings on this device will be erased, then the app sets itself up again fresh. Your notes are NOT touched — the vault stays exactly where it is.",
      confirmLabel: "Reset app data",
      destructive: true,
    });
    if (!confirmed) return;
    onRequestClose?.();
    await resetAppData();
  }, [onRequestClose, resetAppData]);

  return (
    <div className="flex flex-col gap-4 p-3">
      <AiProviderSection />

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground">Appearance</Label>
        <SegmentedControl
          options={THEME_OPTIONS.map(({ value, label, icon: Icon }) => ({
            value,
            label: (
              <>
                <Icon className="size-3.5" />
                {label}
              </>
            ),
          }))}
          value={theme}
          onChange={setTheme}
          className="grid-cols-3"
          optionClassName="flex flex-col items-center gap-1 text-[10px]"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground">Session</Label>
        <div className="flex items-center justify-between rounded-[10px] bg-muted px-3 py-2">
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
        <div className="rounded-[10px] bg-muted">
          <SettingSwitchRow
            label="Notify when idle"
            checked={notifications?.enabled === true}
            onToggle={() => void toggleNotifications(notifications?.enabled !== true)}
            disabled={notifications === null}
          />
          <p className="px-3 pb-2 text-[10px] text-muted-foreground">
            Show an OS notification when the agent finishes a turn while Inteligir is in the
            background.
          </p>
        </div>
      </div>

      <NotesSection />

      <AccountSection />

      <SyncSection onRequestClose={onRequestClose} />

      <RemoteAccessSection />

      <EditorAiSection />

      <VoiceSection />

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground">App data</Label>
        <div className="flex items-center justify-between rounded-[10px] bg-muted px-3 py-2">
          <span className="flex flex-col">
            <span className="text-xs text-foreground">Reset app data</span>
            <span className="text-[10px] text-muted-foreground">
              Erase chat history, connections, and settings on this device. Notes are not touched.
            </span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleResetAppData()}
            disabled={!isReady && appState.phase !== "error"}
            className="h-auto px-2 py-0.5 text-[10px] text-destructive"
          >
            Reset…
          </Button>
        </div>
      </div>
    </div>
  );
}
