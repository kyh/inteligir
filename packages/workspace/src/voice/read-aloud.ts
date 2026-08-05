// ---------------------------------------------------------------------------
// Read page aloud — a palette-launched TTS session over the OPEN note. The
// controller extracts the note's plain text (rich: the live editor's string
// API; raw: the buffer minus frontmatter), chunks it, and queues it through
// the SAME tts client the voice pipeline plays through — no second audio
// path. One session at a time; it stops on the palette's Stop command, a note
// switch/vanish, or voice-conversation mode starting (two live TTS handles
// would both play every chunk).
//
// PRIVACY (fail-closed): a private note's bytes would leave the device for
// ElevenLabs, so start() refuses through the SAME openNoteIsPrivate funnel
// the chat context hint uses — `private: true`, unparseable frontmatter, and
// "no provider registered" all read private. The palette hides the command
// for private notes; this re-check is the defense-in-depth layer, same
// pattern as the editor-AI funnels.
// ---------------------------------------------------------------------------

import { create } from "zustand";

import { ElementApi, NodeApi, type SlateEditor } from "platejs";

import { toast } from "@repo/ui/components/sonner";
import { splitFrontmatter } from "@repo/notes/markdown/frontmatter";

import { getLiveEditor } from "@repo/editor/live-editor";
import { getBridge } from "@repo/bridge/client";
import { useVoiceStore } from "@repo/workspace/stores/voice-store";
import { openNoteIsPrivate } from "@repo/editor/note/open-note-flush";
import { openNoteState, useOpenNote } from "@repo/editor/note/open-note-store";
import { createTTS, type TTSHandle } from "@repo/workspace/voice/tts";

/** Ceiling per ttsSend chunk. Paragraphs stay whole below it; above it they
 * split at sentence boundaries so the synthesizer gets natural prosody units. */
const MAX_CHUNK_CHARS = 500;

/** Reactive session flag for the palette's Read-aloud/Stop label. */
export const useReadAloud = create<{ active: boolean }>()(() => ({ active: false }));

type Session = { tts: TTSHandle; unsubs: (() => void)[] };
let session: Session | null = null;

/** The document's speakable plain text: every top-level block's string,
 * frontmatter node excluded, blocks joined with blank lines (the shape
 * chunkForSpeech splits on). Exported for tests. */
export function editorPlainText(editor: SlateEditor): string {
  return editor.children
    .filter((node) => !(ElementApi.isElement(node) && node.type === "frontmatter"))
    .map((node) => NodeApi.string(node).trim())
    .filter((text) => text !== "")
    .join("\n\n");
}

/** Split text into TTS-sized chunks: one per paragraph (intra-paragraph line
 * breaks collapse to spaces), long paragraphs split at sentence boundaries,
 * a single over-long sentence hard-split at the ceiling. Pure — exported for
 * tests. */
export function chunkForSpeech(text: string, maxChunkChars = MAX_CHUNK_CHARS): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p !== "");
  const chunks: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChunkChars) {
      chunks.push(paragraph);
      continue;
    }
    const sentences = paragraph.match(/[^.!?]*[.!?]+(?:\s+|$)|[^.!?]+$/g) ?? [paragraph];
    let buffer = "";
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed === "") continue;
      if (buffer !== "" && buffer.length + trimmed.length + 1 > maxChunkChars) {
        chunks.push(buffer);
        buffer = "";
      }
      buffer = buffer === "" ? trimmed : `${buffer} ${trimmed}`;
      while (buffer.length > maxChunkChars) {
        chunks.push(buffer.slice(0, maxChunkChars));
        buffer = buffer.slice(maxChunkChars).trim();
      }
    }
    if (buffer !== "") chunks.push(buffer);
  }
  return chunks;
}

/** The open note's speakable text: the live rich editor's plain text when one
 * is mounted, else the raw buffer with the frontmatter block stripped. */
function openNoteSpeechText(path: string): string {
  const live = getLiveEditor(path);
  if (live !== null) return editorPlainText(live);
  return splitFrontmatter(openNoteState().editor.content).body;
}

/**
 * Start reading the open note aloud. Refuses (fail-closed) for private /
 * unparseable-frontmatter notes and while TTS is unconfigured; no-ops when no
 * markdown note is open. Restarting while active re-reads from the top.
 */
export async function startReadAloud(): Promise<void> {
  if (session) stopReadAloud();

  // Fail-closed privacy — the same funnel the chat context hint drains
  // through (registered by VaultProvider; unregistered reads private).
  if (openNoteIsPrivate()) {
    toast("Read aloud is off — this note is private.", { id: "read-aloud-private" });
    return;
  }

  const doc = openNoteState().openDoc;
  if (doc.kind !== "markdown") return;
  const path = doc.path;

  const chunks = chunkForSpeech(openNoteSpeechText(path));
  if (chunks.length === 0) {
    toast("Nothing to read on this page.", { id: "read-aloud-empty" });
    return;
  }

  const available = await getBridge()
    .isTtsAvailable()
    .catch(() => false);
  if (!available) {
    toast.error("Add an ElevenLabs API key in Settings → Voice.", { id: "read-aloud-tts" });
    return;
  }
  // The probe awaited — re-check the world before sending a byte: the note
  // may have switched (or flipped private) meanwhile, and a concurrent
  // start() may already own a session.
  if (session !== null || openNoteState().openPath !== path || openNoteIsPrivate()) return;

  // One TTS consumer at a time: leave voice-conversation mode BEFORE
  // subscribing, so our own stop-on-voice watcher below doesn't fire.
  useVoiceStore.getState().stopVoice();

  const tts = createTTS();
  session = {
    tts,
    unsubs: [
      // Note switch or vanish — the text no longer matches what's on screen.
      useOpenNote.subscribe((s) => {
        if (s.openPath !== path) stopReadAloud();
      }),
      // Voice-conversation start — its pipeline owns the TTS stream now.
      useVoiceStore.subscribe((s) => {
        if (s.state.kind !== "idle") stopReadAloud();
      }),
    ],
  };
  useReadAloud.setState({ active: true });

  for (const chunk of chunks) tts.sendText(chunk);
  tts.flush();
}

/** Stop the session: halt local playback, discard the host's queued text
 * (interrupt), and release the audio context + bridge subscription. */
export function stopReadAloud(): void {
  const current = session;
  if (current === null) return;
  session = null;
  for (const unsub of current.unsubs) unsub();
  current.tts.interrupt();
  current.tts.close();
  useReadAloud.setState({ active: false });
}
