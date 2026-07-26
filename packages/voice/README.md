# @repo/voice

Local on-device STT for the Inteligir host — sherpa-onnx streaming Parakeet plus
its pinned-checksum model downloader — and the ElevenLabs streaming-TTS proxy
with the voice API-key store over @repo/storage's SecretStore.

## Why it exists

Runs in the desktop main process (node; loads a native addon, opens the
outbound ElevenLabs websocket so the API key never sits in renderer memory).
Sits BELOW @repo/server in the dep DAG — it never imports server or electron;
workspace deps are @repo/bridge (wire helpers + the `VoiceModelStateEvent`
type + `ELEVENLABS_API_KEY_UI_STATE`) and @repo/storage (the encrypted
SecretStore behind the voice secret). Its own package so the native/ML/vendor
surface stays quarantined behind four narrow subpath exports instead of
leaking into the host.

## Layout

```
src/
  parakeet.ts           # Streaming recognizer: lazy init (discriminated InitResult),
                        #   startSession / pushAudio(Float32 PCM) / stopSession
  model-download.ts     # Model fetch+extract (tar.bz2, pure Node), SHA-256 pinned,
                        #   idempotent + inflight-shared; VoiceModelHost seam lives here
  sherpa-onnx-node.d.ts # Ambient decl for the untyped native module — loaded via a
                        #   types-only /// reference so no runtime import is emitted
  tts-proxy.ts          # ElevenLabs streaming TTS: one lazy WS per session, text in /
                        #   base64 PCM out (emitted via the injected sink); TtsHost seam
  voice-secret.ts       # The ElevenLabs key: plaintext into the SecretStore, only a
                        #   `true` presence marker into the caller-bound ui-state sink
  __tests__/            # voice-secret.test.ts (marker/secret routing contract),
                        #   tts-proxy.test.ts (base64→PCM decode + WS lifecycle)
```

## Invariants

- **Checksum fail-closed.** The model archive must match the pinned
  `MODEL_SHA256`; a mismatch aborts the install. An upstream re-upload
  requires an audit + repin, never a silent accept.
- **Interrupted installs don't count.** `isModelInstalled` requires all four
  model files (encoder/decoder/joiner/tokens), not a single sentinel.
- **Boot-timing guard.** Before `configureVoiceModelHost` runs, probes answer
  "not installed", `downloadModel` fails as a VALUE, and progress events drop
  silently — nothing throws for racing composition.
- **Model dir is the host's per-user data dir** (`userDataDir()/stt/…`), NOT
  `~/.inteligir` — logout wipes the latter and would force re-downloads.
- **Native module loads lazily.** `sherpa-onnx-node` is imported only at
  `initParakeet`, so the app boots fine with no model; the renderer just sees
  STT unavailable.
- `stopSession` captures the stream at entry: a racing `startSession`
  (renderer stop+start back-to-back over IPC) can't have its fresh stream
  finished or nulled by the old session's teardown.
- **The TTS key never reaches ui-state or the renderer.** voice-secret writes
  the plaintext to the encrypted SecretStore and only a `true` presence
  marker to the caller-bound marker sink; the proxy resolves the key lazily
  per connection/availability check (stored key first, `ELEVENLABS_API_KEY`
  env as the dev-only fallback), so a key saved mid-session works without a
  restart.

## Seams

- `VoiceModelHost` (`{ userDataDir, emitState }`) — installed once via
  `configureVoiceModelHost` by the composition root,
  `packages/server/src/boot/create-host.ts`.
- `TtsHost` (`{ getApiKey, emitAudio }`) — installed via `configureTts` at
  handler-register time (`packages/server/src/handlers/voice-handlers.ts`):
  the key source is voice-secret's SecretStore read, the audio sink is an
  `onTtsAudio` event-bus emit (voice/ never imports the event bus).
- voice-secret's marker sink (ui-state) is PASSED PER CALL — ui-state is a
  server store and voice sits below the server.

Handlers (`voice-handlers.ts`) drive the recognizer and the TTS proxy;
`app-machine.ts` triggers `downloadModel`.

## Testing

```bash
pnpm --filter @repo/voice test
```

`voice-secret.test.ts` pins the secret/marker routing (trimmed key into the
secret sink, `true`-only marker, clear-on-empty); `tts-proxy.test.ts` pins the
base64→PCM decode (byteOffset/byteLength honored) and the connection
lifecycle over the injected socket seam. STT is exercised through the server's
voice handlers and transport tests.
