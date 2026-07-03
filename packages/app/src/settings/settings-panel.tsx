import { useCallback, useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@repo/ui/components/button";
import { Switch } from "@repo/ui/components/switch";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { cn } from "@repo/ui/lib/utils";

import { getBridge } from "@repo/app/lib/bridge";
import { useTheme, type Theme } from "@repo/app/lib/use-theme";
import { useAgentStore } from "@repo/app/stores/agent-store";
import { useAiSettingsStore } from "@repo/app/stores/ai-settings-store";
import { useVoiceStore } from "@repo/app/stores/voice-store";
import type { NotificationSettings } from "@repo/core/ipc";
import { ELEVENLABS_API_KEY_UI_STATE } from "@repo/core/voice";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof SunIcon }[] = [
  { value: "system", label: "System", icon: MonitorIcon },
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
];

// Voice calls need an ElevenLabs API key for speech playback (the whole
// pipeline — mic included — is gated on TTS availability in voice-store).
// Saving through setUiState routes the plaintext into main's encrypted
// SecretStore; ui-state itself only ever carries a `true` presence marker,
// which is what the hasStoredKey check below reads. Saving here enables
// voice without an app restart.
function VoiceSection() {
  const [ttsConfigured, setTtsConfigured] = useState<boolean | null>(null);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) return;
    void bridge
      .isTtsAvailable()
      .then(setTtsConfigured)
      .catch(() => {});
    void bridge
      .getUiState()
      .then((values) => {
        const stored = values[ELEVENLABS_API_KEY_UI_STATE];
        // `true` = key lives in the encrypted secret store. A plaintext
        // string can only appear if main's one-time migration hasn't run,
        // which can't happen (constructing the manager runs it) — accept it
        // anyway so a stored key never reads as missing.
        setHasStoredKey(stored === true || (typeof stored === "string" && stored.length > 0));
        return undefined;
      })
      .catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    const bridge = getBridge();
    const value = keyInput.trim();
    if (!bridge || !value) return;
    setBusy(true);
    setError(null);
    try {
      await bridge.setUiState({ key: ELEVENLABS_API_KEY_UI_STATE, value });
      const wasConfigured = ttsConfigured === true;
      setKeyInput("");
      setHasStoredKey(true);
      setTtsConfigured(true);
      // voice-store only constructs the pipeline when TTS is available at
      // init; re-init so the dock mic works now instead of after a restart.
      if (!wasConfigured) useVoiceStore.getState().init();
    } catch {
      setError("Failed to save the API key.");
    } finally {
      setBusy(false);
    }
  }, [keyInput, ttsConfigured]);

  const handleRemove = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    setBusy(true);
    setError(null);
    try {
      // Writing `undefined` clears the secret store entry + presence marker.
      await bridge.setUiState({ key: ELEVENLABS_API_KEY_UI_STATE, value: undefined });
      setHasStoredKey(false);
      // The env fallback (dev) can keep TTS available with no stored key.
      const available = await bridge.isTtsAvailable().catch(() => false);
      setTtsConfigured(available);
      if (!available) useVoiceStore.getState().reset();
    } catch {
      setError("Failed to remove the API key.");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Voice</Label>
      <div className="flex flex-col gap-1.5 rounded-[12px] bg-muted px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="flex flex-col">
            <span className="text-xs text-foreground">ElevenLabs API key</span>
            <span className="text-[10px] text-muted-foreground">
              {ttsConfigured === null
                ? "Checking…"
                : ttsConfigured
                  ? "Configured — voice calls are enabled."
                  : "Voice calls are disabled until a key is added."}
            </span>
          </span>
          {hasStoredKey && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleRemove()}
              disabled={busy}
              className="h-auto px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              Remove
            </Button>
          )}
        </div>
        <Input
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={hasStoredKey ? "Replace key" : "ElevenLabs API key"}
          type="password"
          className="h-7 text-xs"
        />
        <Button
          variant="tertiary"
          size="sm"
          onClick={() => void handleSave()}
          disabled={busy || keyInput.trim().length === 0}
          className="h-7 self-start px-3 text-[10px]"
        >
          {busy ? "Saving…" : "Save key"}
        </Button>
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    </div>
  );
}

// Ghost text is on by default (potion behavior); the switch opts out for
// users who'd rather not spend tokens on every typing pause. The model
// picker names the fast tier the host would use by default.
function EditorAiSection() {
  const loaded = useAiSettingsStore((s) => s.loaded);
  const enabled = useAiSettingsStore((s) => s.ghostTextEnabled);
  const model = useAiSettingsStore((s) => s.ghostTextModel);
  const models = useAiSettingsStore((s) => s.models);
  const defaultModelId = useAiSettingsStore((s) => s.defaultModelId);
  const init = useAiSettingsStore((s) => s.init);
  const setEnabled = useAiSettingsStore((s) => s.setGhostTextEnabled);
  const setModel = useAiSettingsStore((s) => s.setGhostTextModel);

  useEffect(() => {
    void init();
  }, [init]);

  const effectiveId = model ?? defaultModelId;

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs font-medium text-muted-foreground">Editor AI</Label>
      <div className="rounded-[12px] bg-muted">
        <Switch
          label="Ghost text completions"
          checked={enabled}
          onToggle={() => void setEnabled(!enabled)}
          disabled={!loaded}
          className="w-full flex-row-reverse justify-between text-xs"
        />
        <p className="px-3 pb-2 text-[10px] text-muted-foreground">
          Grey inline completions after a typing pause — Tab accepts, Escape dismisses. Runs on a
          fast model with your OpenAI account.
        </p>
        {enabled && models.length > 0 && (
          <div className="flex items-center justify-between gap-2 px-3 pb-2">
            <span className="text-xs text-foreground">Completion model</span>
            {/* Native select: a portaled Base UI menu popup inside the
                settings Dialog reads as an outside press and dismisses it. */}
            <select
              value={effectiveId ?? ""}
              onChange={(e) => void setModel(e.target.value)}
              className="h-6 max-w-[55%] rounded-md bg-card px-1.5 text-[10px] font-medium text-muted-foreground shadow-surface-2 outline-none transition-colors hover:text-foreground"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.id === defaultModelId ? " (default)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsPanel() {
  const appState = useAgentStore((s) => s.appState);
  const newSession = useAgentStore((s) => s.newSession);
  const isReady = appState.phase === "ready";
  const canStartNewSession = isReady && appState.agent === "idle";

  const { theme, setTheme } = useTheme();
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null);
  const [reauthBusy, setReauthBusy] = useState(false);

  useEffect(() => {
    const promise = getBridge()?.getNotificationSettings();
    if (!promise) return;
    void promise.then(setNotifications).catch(() => {});
  }, []);

  const handleLogout = useCallback(() => {
    getBridge()?.transition({ type: "LOGOUT" });
  }, []);

  const handleReauthenticate = useCallback(async () => {
    setReauthBusy(true);
    try {
      await getBridge()?.reauthenticate();
    } finally {
      setReauthBusy(false);
    }
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
        {/* Segmented control on a sunken track — selected segment lifts to a
            card-white pill (the refs' Objects/Prompts switcher). */}
        <div className="grid grid-cols-3 gap-1 rounded-[12px] bg-muted p-1">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              aria-pressed={theme === value}
              className={cn(
                "flex flex-col items-center gap-1 rounded-[8px] px-2 py-1.5 text-[10px] transition-colors",
                theme === value
                  ? "bg-card text-foreground shadow-surface-2"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>
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
          <Switch
            label="Notify when idle"
            checked={notifications?.enabled === true}
            onToggle={() => void toggleNotifications(notifications?.enabled !== true)}
            disabled={notifications === null}
            className="w-full flex-row-reverse justify-between text-xs"
          />
          <p className="px-3 pb-2 text-[10px] text-muted-foreground">
            Show an OS notification when the agent finishes a turn while Inteligir is in the
            background.
          </p>
        </div>
      </div>

      <EditorAiSection />

      <VoiceSection />
    </div>
  );
}
