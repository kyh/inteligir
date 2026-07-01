# `@repo/desktop` — Inteligir Electron app

Three-process Electron app: an AI-native notes workspace (sidebar file tree, markdown editor, chat) over a pi-coding-agent runtime. The agent does real work (edits the user's vault files, plus shell, browser via agent-browser CLI, connected APIs — Google Workspace and more — via executor code mode).

## Layout

```
src/
  main/      Electron main process — app lifecycle, agent singleton, IPC, auto-updater
  preload/   Bridge — exposes a typed window.desktopBridge to the renderer over contextBridge
  renderer/  Entry shim — index.html + main.tsx that install window.desktopBridge into @repo/app
  agent/     pi-coding-agent composition — extension bundles + Agent class
  __tests__/ Vitest suites — reducer, machine, effects, etc.

resources/   Bundled assets shipped inside the .app — agent skills, AGENTS.md, icons
scripts/     Build-time verifiers (runtime deps, model registry)
```

Each top-level dir has its own README where the architecture isn't obvious from reading code:

- [`src/main/README.md`](./src/main/README.md) — state machine triad, IPC pattern, how to add an effect
- [`src/agent/README.md`](./src/agent/README.md) — pi extension bundle pattern, how to add an extension

## Process boundary

```
renderer (sandboxed Chromium)
   ↕  contextBridge → window.desktopBridge
preload (Node, isolated)
   ↕  ipcRenderer ⇄ ipcMain
main (full Node + Electron)
   ↕  Agent (pi-coding-agent)
filesystem / shell / agent-browser CLI / executor daemon (connected APIs)
```

- **Renderer** never touches Node APIs. Sandboxed, no nodeIntegration, contextIsolation on.
- **Preload** is the narrow bridge. Validates inbound, types outbound.
- **Main** is where everything real happens. Holds the agent singleton, manages auth, runs the state machine.

IPC is typed end-to-end via the registry in `@repo/core/ipc-registry`: each method pairs a channel name with a TypeBox payload schema (runtime-validated in main via `Value.Check`) and a result/event type. The preload bridge and the `Bridge` type are both derived from the registry, so renaming a method or changing a payload shape produces a typecheck error in both processes.

## App lifecycle

The state machine in `src/main/` drives onboarding:

```
logged_out → logging_in → logged_in → setting_up → ready
                  ↓                        ↓           ↓
                error                    error      logging_out
```

`setting_up` runs `seedResources()` (skills, bin dir, PATH, all extension bundle setups), then `downloadVoiceModel()` (best-effort — see [Voice](#voice)), then `startAgent()`. See [`src/main/README.md`](./src/main/README.md).

## Voice

Streaming voice is local: **STT via NVIDIA NeMo Parakeet** (running through `sherpa-onnx-node` in the main process) + ElevenLabs Flash TTS. No audio leaves the device. Architecture:

```
renderer:  mic → AudioWorklet (16kHz Float32 PCM, ~128ms frames)
              ↓ IPC
main:      Parakeet OnlineRecognizer (streaming partials + endpoint detection)
              ↓ IPC
renderer:  voice-machine (state) → voice-store → chat agent / UI
              ↓
           ElevenLabs TTS ← agent text deltas
```

- `packages/app/src/voice/` — `stt.ts` (mic + worklet), `stt-worklet.js` (audio thread), `tts.ts` (ElevenLabs WS), `voice-pipeline.ts` (pure I/O wrapper), `voice-machine.ts` (state machine — single source of truth)
- `packages/app/src/stores/voice-store.ts` — zustand projection of `VoiceMachine`. All async ops generation-guarded against teardown/swap races.
- `src/main/voice/parakeet.ts` — singleton recognizer + audio chunk handler
- `src/main/voice/model-download.ts` — fetches the model to `app.getPath("userData")/stt/` on first run via the `setting_up` step. Download failure is non-fatal; the user can retry from the mic toggle later.

The model is ~140 MB and downloads automatically during onboarding — no manual setup. STT requires no API keys; TTS requires `ELEVENLABS_API_KEY` (+ optional `ELEVENLABS_VOICE_ID`) in `.env`.

Tests in `packages/app/src/__tests__/voice-machine.test.ts` + `voice-store.test.ts` cover the state-machine reducer and the async race patterns (teardown mid-flight, pipeline-identity swap, reset during download, etc.).

## Dev

```bash
pnpm dev:desktop
```

Opens Electron with HMR (renderer) + tsc watch (main/preload). CDP exposed on port 9222 — inspect with `agent-browser --session inteligir-desktop connect 9222` (see root `AGENTS.md`).

## Build & ship

- `pnpm build` — `electron.vite.config.ts` bundles main/preload/renderer; `tsc` typechecks.
- `electron-builder.yml` packages the .app and configures auto-update.
- `scripts/verify-packaged-runtime-deps.mjs` runs in CI to catch missing native deps before release.

## Adding things — quick map

| Adding...                                 | Where                                                                                                                                      | See                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| New IPC method                            | Registry entry in `@repo/core/ipc-registry` + `handle()` in `main/{index,vault-ipc,executor-ipc}.ts` (preload bridge is derived)           | `main/README.md`                   |
| New app state phase                       | `@repo/core/app-state` + reducer + tests                                                                                                   | `main/README.md`                   |
| New side effect on transition             | `main/app-effects.ts` + `EffectDeps` + machine wiring                                                                                      | `main/README.md`                   |
| New pi tool / 3rd-party integration       | `agent/<name>/extension.ts` + glob picks it up                                                                                             | `agent/README.md`                  |
| Reusable install primitive                | `packages/agent-runtime/`                                                                                                                  | `packages/agent-runtime/README.md` |
| New workspace feature (sidebar/editor)    | A component under `packages/app/src/{sidebar,editor,composer,settings}/` wired into `workspace/workspace-page.tsx`; vault via `useVault()` | (no README — standard React)       |
| Bundled resource (skill, AGENTS.md, etc.) | `resources/agent/` + reference in `agent/setup.ts`                                                                                         | `agent/README.md`                  |
