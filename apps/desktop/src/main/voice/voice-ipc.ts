// ---------------------------------------------------------------------------
// Voice IPC handler registration
// ---------------------------------------------------------------------------

import { BrowserWindow, ipcMain, safeStorage } from "electron";

import { IPC_CHANNELS } from "@/shared/ipc";
import type { VoiceEvent } from "@/shared/voice";

import { getVoiceSettings, setVoiceSettings } from "./voice-settings-store";
import type { VoiceService } from "./voice-service";

function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

function broadcastVoiceEvent(event: VoiceEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.VOICE_EVENT, event);
    }
  }
}

export function registerVoiceIpcHandlers(voiceService: VoiceService): () => void {
  // Subscribe to voice events and broadcast to renderer
  const unsubscribe = voiceService.subscribe(broadcastVoiceEvent);

  ipcMain.handle(IPC_CHANNELS.VOICE_START, async () => {
    return voiceService.start();
  });

  ipcMain.handle(IPC_CHANNELS.VOICE_STOP, () => {
    return voiceService.stop();
  });

  ipcMain.handle(IPC_CHANNELS.VOICE_INTERRUPT_TTS, () => {
    return voiceService.interruptTts();
  });

  ipcMain.handle(IPC_CHANNELS.VOICE_GET_SETTINGS, () => {
    const s = getVoiceSettings();
    return {
      settings: s
        ? { apiKeyMasked: maskKey(s.apiKey), voiceId: s.voiceId }
        : null,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  });

  ipcMain.handle(IPC_CHANNELS.VOICE_SET_SETTINGS, (_event, raw: unknown) => {
    // Zod validation inside setVoiceSettings (throws on invalid input)
    setVoiceSettings(raw);
    return { ok: true };
  });

  // Audio chunks — using handle/invoke for reliability
  let ipcChunkCount = 0;
  ipcMain.handle(IPC_CHANNELS.VOICE_AUDIO_CHUNK, (_event, base64: unknown) => {
    ipcChunkCount++;
    if (ipcChunkCount <= 3) {
      console.log(`[voice-ipc] chunk #${ipcChunkCount}, type=${typeof base64}, len=${typeof base64 === "string" ? base64.length : "N/A"}`);
    }
    if (typeof base64 === "string") {
      voiceService.sendAudio(base64);
    }
  });

  return () => {
    unsubscribe();
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_START);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_STOP);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_INTERRUPT_TTS);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_GET_SETTINGS);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_SET_SETTINGS);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_AUDIO_CHUNK);
  };
}
