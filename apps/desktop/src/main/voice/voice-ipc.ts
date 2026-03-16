// ---------------------------------------------------------------------------
// Voice IPC handler registration
// ---------------------------------------------------------------------------

import { BrowserWindow, ipcMain } from "electron";

import { IPC_CHANNELS } from "@/shared/ipc";
import type { VoiceEvent, VoiceSettings } from "@/shared/voice";

import { getVoiceSettings, setVoiceSettings } from "./voice-settings-store";
import type { VoiceService } from "./voice-service";

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
    return getVoiceSettings();
  });

  ipcMain.handle(IPC_CHANNELS.VOICE_SET_SETTINGS, (_event, raw: unknown) => {
    const settings = raw as VoiceSettings;
    if (!settings || typeof settings.apiKey !== "string") {
      throw new Error("Invalid voice settings");
    }
    setVoiceSettings(settings);
    return { ok: true };
  });

  // Audio chunks use ipcMain.on (fire-and-forget) for performance
  const audioChunkHandler = (_event: Electron.IpcMainEvent, base64: unknown) => {
    if (typeof base64 === "string") {
      voiceService.sendAudio(base64);
    }
  };
  ipcMain.on(IPC_CHANNELS.VOICE_AUDIO_CHUNK, audioChunkHandler);

  return () => {
    unsubscribe();
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_START);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_STOP);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_INTERRUPT_TTS);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_GET_SETTINGS);
    ipcMain.removeHandler(IPC_CHANNELS.VOICE_SET_SETTINGS);
    ipcMain.removeListener(IPC_CHANNELS.VOICE_AUDIO_CHUNK, audioChunkHandler);
  };
}
