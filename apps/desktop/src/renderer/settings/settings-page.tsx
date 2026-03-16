import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";

import { getBridge } from "@/renderer/lib/bridge";
import { useAgentStore } from "@/renderer/stores/agent-store";
import { useVoiceStore } from "@/renderer/stores/voice-store";
import { DEFAULT_VOICE_ID } from "@/shared/voice";

export function SettingsPage() {
  const navigate = useNavigate();
  const appState = useAgentStore((s) => s.appState);
  const clearMessages = useAgentStore((s) => s.clearMessages);
  const loadVoiceSettings = useVoiceStore((s) => s.loadSettings);

  const isReady = appState.phase === "ready";

  // Voice settings state
  const [apiKey, setApiKey] = useState("");
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID);
  const [voiceSaved, setVoiceSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const settings = await getBridge()?.getVoiceSettings();
      if (settings) {
        setApiKey(settings.apiKey);
        setVoiceId(settings.voiceId || DEFAULT_VOICE_ID);
      }
    }
    void load();
  }, []);

  const goBack = useCallback(() => {
    void navigate("/");
  }, [navigate]);

  const handleLogout = useCallback(() => {
    clearMessages();
    getBridge()?.transition({ type: "LOGOUT" });
  }, [clearMessages]);

  const handleSaveVoice = useCallback(() => {
    const bridge = getBridge();
    if (!bridge) return;
    async function save() {
      await bridge.setVoiceSettings({ apiKey, voiceId: voiceId || DEFAULT_VOICE_ID });
      setVoiceSaved(true);
      void loadVoiceSettings();
      setTimeout(() => setVoiceSaved(false), 2000);
    }
    void save();
  }, [apiKey, voiceId, loadVoiceSettings]);

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

        {/* Voice settings */}
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium text-muted-foreground">
            Voice (ElevenLabs)
          </Label>

          <div className="flex flex-col gap-2 rounded-md border border-border px-3 py-2">
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">API Key</Label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="h-7 text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-[10px] text-muted-foreground">
                Voice ID
              </Label>
              <Input
                value={voiceId}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setVoiceId(e.target.value)}
                placeholder={DEFAULT_VOICE_ID}
                className="h-7 text-xs"
              />
              <span className="text-[9px] text-muted-foreground">
                Default: Samantha ({DEFAULT_VOICE_ID})
              </span>
            </div>

            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveVoice}
                disabled={!apiKey.trim()}
                className="h-auto px-2 py-0.5 text-[10px]"
              >
                {voiceSaved ? "Saved!" : "Save"}
              </Button>
            </div>
          </div>
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
