# @repo/voice

Local on-device STT for the Inteligir host: sherpa-onnx streaming Parakeet plus
its pinned-checksum model downloader.

## Why it exists

Runs in the desktop main process (node; loads a native addon). Sits BELOW
@repo/server in the dep DAG — it never imports server or electron; sole
workspace dep is @repo/bridge (wire helpers + the `VoiceModelStateEvent`
type). Its own package so the native/ML surface stays quarantined behind two
narrow subpath exports instead of leaking into the host.

## Layout

```
src/
  parakeet.ts           # Streaming recognizer: lazy init (discriminated InitResult),
                        #   startSession / pushAudio(Float32 PCM) / stopSession
  model-download.ts     # Model fetch+extract (tar.bz2, pure Node), SHA-256 pinned,
                        #   idempotent + inflight-shared; VoiceModelHost seam lives here
  sherpa-onnx-node.d.ts # Ambient decl for the untyped native module — loaded via a
                        #   types-only /// reference so no runtime import is emitted
```

## Invariants

- **Checksum fail-closed.** The model archive must match the pinned
  `MODEL_SHA256`; a mismatch aborts install — upstream re-uploads require an
  audit + repin, never a silent accept.
- **Interrupted installs don't count.** `isModelInstalled` requires all four
  model files (encoder/decoder/joiner/tokens), not a single sentinel.
- **Boot-timing guard (#465.3).** Before `configureVoiceModelHost` runs,
  probes answer "not installed", `downloadModel` fails as a VALUE, and
  progress events drop silently — nothing throws for racing composition.
- **Model dir is the host's per-user data dir** (`userDataDir()/stt/…`), NOT
  `~/.inteligir` — logout wipes the latter and would force re-downloads.
- **Native module loads lazily.** `sherpa-onnx-node` is imported only at
  `initParakeet`, so the app boots fine with no model; the renderer just sees
  STT unavailable.
- `stopSession` captures the stream at entry: a racing `startSession`
  (renderer stop+start back-to-back over IPC) can't have its fresh stream
  finished or nulled by the old session's teardown.

## Seams

`VoiceModelHost` (`{ userDataDir, emitState }`) is the only injected port —
installed once via `configureVoiceModelHost` by the composition root,
`packages/server/src/boot/create-host.ts`. Handlers
(`packages/server/src/handlers/voice-handlers.ts`) drive the recognizer;
`app-machine.ts` triggers `downloadModel`.

## Testing

No test suite — `pnpm --filter @repo/voice typecheck` is the package gate;
behavior is exercised through the server's voice handlers.
