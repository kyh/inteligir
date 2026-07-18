import { useCallback, useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { Label } from "@repo/ui/components/label";

import { SegmentedControl } from "@renderer/components/segmented-control";
import { getBridge } from "@renderer/lib/bridge";
import { useTheme, type Theme } from "@renderer/lib/use-theme";
import { EditorAiSection } from "@renderer/settings/sections/editor-ai-section";
import { NotesSection } from "@renderer/settings/sections/notes-section";
import { RemoteAccessSection } from "@renderer/settings/sections/remote-access-section";
import { SettingSwitchRow } from "@renderer/settings/sections/setting-switch-row";
import { SyncSection } from "@renderer/settings/sections/sync-section";
import { VoiceSection } from "@renderer/settings/sections/voice-section";
import { useAgentStore } from "@renderer/stores/agent-store";
import type { NotificationSettings } from "@repo/features/ipc-registry";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

export function SettingsPanel({ onRequestClose }: { onRequestClose?: () => void }) {
  const appState = useAgentStore((s) => s.appState);
  const newSession = useAgentStore((s) => s.newSession);
  const isReady = appState.phase === "ready";
  const canStartNewSession = isReady && appState.agent === "idle";

  const { theme, setTheme } = useTheme();
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null);
  const [reauthBusy, setReauthBusy] = useState(false);

  useEffect(() => {
    void getBridge()
      .getNotificationSettings()
      .then(setNotifications)
      .catch(() => {});
  }, []);

  const handleLogout = useCallback(() => {
    getBridge().transition({ type: "LOGOUT" });
  }, []);

  const handleReauthenticate = useCallback(async () => {
    setReauthBusy(true);
    try {
      await getBridge().reauthenticate();
    } finally {
      setReauthBusy(false);
    }
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

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground">OpenAI Account</Label>
        {isReady ? (
          <div className="flex items-center justify-between rounded-[10px] bg-muted px-3 py-2">
            <span className="text-xs text-foreground">Connected</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReauthenticate}
                disabled={reauthBusy}
                className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {reauthBusy ? "Opening…" : "Re-authenticate"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                Log out
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-[10px] bg-muted px-3 py-2">
            <span className="text-xs text-muted-foreground">Not connected</span>
          </div>
        )}
      </div>

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

      <SyncSection onRequestClose={onRequestClose} />

      <RemoteAccessSection />

      <EditorAiSection />

      <VoiceSection />
    </div>
  );
}
