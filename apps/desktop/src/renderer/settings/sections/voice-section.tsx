import { useCallback, useEffect, useState } from "react";
import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";

import { getBridge } from "@renderer/lib/bridge";
import { useVoiceStore } from "@renderer/stores/voice-store";
import { ELEVENLABS_API_KEY_UI_STATE } from "@repo/bridge/voice";

// Voice calls need an ElevenLabs API key for speech playback (the whole
// pipeline — mic included — is gated on TTS availability in voice-store).
// Saving goes through the voice-owned setVoiceApiKey channel: the host
// writes the plaintext into the encrypted SecretStore; ui-state only ever
// carries a `true` presence marker, which is what the hasStoredKey check
// below reads. Saving here enables voice without an app restart.
export function VoiceSection() {
  const [ttsConfigured, setTtsConfigured] = useState<boolean | null>(null);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = getBridge();
    void bridge
      .isTtsAvailable()
      .then(setTtsConfigured)
      .catch(() => {});
    void bridge
      .getUiState()
      .then((values) => {
        const stored = values[ELEVENLABS_API_KEY_UI_STATE];
        // `true` = key lives in the encrypted secret store. A plaintext
        // string can only appear in a store written by a pre-secret-store
        // build — accept it anyway so a stored key never reads as missing.
        setHasStoredKey(stored === true || (typeof stored === "string" && stored.length > 0));
        return undefined;
      })
      .catch(() => {});
  }, []);

  const handleSave = useCallback(async () => {
    const bridge = getBridge();
    const value = keyInput.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      await bridge.setVoiceApiKey({ value });
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
    setBusy(true);
    setError(null);
    try {
      // An absent value clears the secret store entry + presence marker.
      await bridge.setVoiceApiKey({});
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
          variant="outline"
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
