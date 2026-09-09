// the archive is a committed fixture because node has no bzip2 encoder; its sha is derived
// from the bytes so the fixture and the pin cannot drift.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import type { VoiceModelSpec } from "../model-catalog";
import {
  downloadModel,
  isModelInstalled,
  modelDirFor,
  ModelDownloadError,
  removeModel,
  resolveModelFiles,
} from "../model-store";

const FIXTURE = readFileSync(
  fileURLToPath(new URL("fixtures/test-model.tar.bz2", import.meta.url)),
);

const specFor = (archive: Buffer): VoiceModelSpec => ({
  files: {
    decoder: "decoder.onnx",
    encoder: "encoder.onnx",
    joiner: "joiner.onnx",
    tokens: "tokens.txt",
  },
  id: "test-model",
  label: "Test model",
  sha256: createHash("sha256").update(archive).digest("hex"),
  sizeBytes: archive.byteLength,
  url: "https://models.test/model.tar.bz2",
});

// two chunks, so progress is observable.
const fetchServing =
  (body: Buffer): typeof fetch =>
  // oxlint-disable-next-line require-await -- `fetch` is an async port; this fake answers from memory
  async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const half = Math.ceil(body.byteLength / 2);
          controller.enqueue(new Uint8Array(body.subarray(0, half)));
          controller.enqueue(new Uint8Array(body.subarray(half)));
          controller.close();
        },
      }),
    );

describe("downloadModel", () => {
  it("extracts every model file, drops the rest, and reports progress to the size", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(FIXTURE);
    const progress: number[] = [];
    await downloadModel({
      fetchImpl: fetchServing(FIXTURE),
      modelDir,
      onProgress: (received) => {
        progress.push(received);
      },
      signal: new AbortController().signal,
      spec,
    });

    const files = resolveModelFiles(modelDir, spec);
    expect(readFileSync(files.encoder, "utf-8")).toBe("encoder-bytes");
    expect(readFileSync(files.tokens, "utf-8")).toBe("a b c\n");
    expect(await isModelInstalled(modelDir, spec)).toBe(true);
    expect(existsSync(`${modelDirFor(modelDir, spec)}/test_wavs`)).toBe(false);
    expect(progress.at(-1)).toBe(FIXTURE.byteLength);
    expect(progress.length).toBeGreaterThan(1);
  });

  it("refuses a body that does not match the pinned digest, and installs nothing", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(FIXTURE);
    const tampered = Buffer.concat([FIXTURE.subarray(0, FIXTURE.byteLength - 1), Buffer.from([0])]);
    await expect(
      downloadModel({
        fetchImpl: fetchServing(tampered),
        modelDir,
        onProgress: () => {},
        signal: new AbortController().signal,
        spec,
      }),
    ).rejects.toThrow(ModelDownloadError);
    expect(await isModelInstalled(modelDir, spec)).toBe(false);
    expect(existsSync(modelDirFor(modelDir, spec))).toBe(false);
  });

  it("refuses a body longer than the pin without writing all of it", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(FIXTURE);
    await expect(
      downloadModel({
        fetchImpl: fetchServing(Buffer.concat([FIXTURE, Buffer.alloc(1024)])),
        modelDir,
        onProgress: () => {},
        signal: new AbortController().signal,
        spec,
      }),
    ).rejects.toThrow(/larger than/u);
    expect(await isModelInstalled(modelDir, spec)).toBe(false);
  });

  it("refuses a truncated body", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(FIXTURE);
    await expect(
      downloadModel({
        fetchImpl: fetchServing(FIXTURE.subarray(0, 32)),
        modelDir,
        onProgress: () => {},
        signal: new AbortController().signal,
        spec,
      }),
    ).rejects.toThrow(/not the/u);
    expect(await isModelInstalled(modelDir, spec)).toBe(false);
  });

  it("says which host it could not reach", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    await expect(
      downloadModel({
        fetchImpl: () => {
          throw new Error("getaddrinfo ENOTFOUND");
        },
        modelDir,
        onProgress: () => {},
        signal: new AbortController().signal,
        spec: specFor(FIXTURE),
      }),
    ).rejects.toThrow(/models\.test/u);
  });

  it("answers a non-2xx with its status", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    await expect(
      downloadModel({
        // oxlint-disable-next-line require-await -- `fetch` is an async port; this fake answers from memory
        fetchImpl: async () => new Response("gone", { status: 404 }),
        modelDir,
        onProgress: () => {},
        signal: new AbortController().signal,
        spec: specFor(FIXTURE),
      }),
    ).rejects.toThrow(/404/u);
  });
});

describe("isModelInstalled", () => {
  it("is false when a model file is missing — a crash mid-extract", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(FIXTURE);
    const files = resolveModelFiles(modelDir, spec);
    await mkdir(modelDirFor(modelDir, spec), { recursive: true });
    writeFileSync(files.encoder, "x");
    writeFileSync(files.decoder, "x");
    writeFileSync(files.joiner, "x");
    expect(await isModelInstalled(modelDir, spec)).toBe(false);
  });

  it("is false for an empty file — a crash between create and write", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(FIXTURE);
    const files = resolveModelFiles(modelDir, spec);
    await mkdir(modelDirFor(modelDir, spec), { recursive: true });
    writeFileSync(files.encoder, "x");
    writeFileSync(files.decoder, "x");
    writeFileSync(files.joiner, "x");
    writeFileSync(files.tokens, "");
    expect(await isModelInstalled(modelDir, spec)).toBe(false);
  });
});

describe("removeModel", () => {
  it("takes the model and any staging beside it, and is idempotent", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(FIXTURE);
    await downloadModel({
      fetchImpl: fetchServing(FIXTURE),
      modelDir,
      onProgress: () => {},
      signal: new AbortController().signal,
      spec,
    });
    expect(await isModelInstalled(modelDir, spec)).toBe(true);

    await removeModel(modelDir, spec);
    expect(existsSync(modelDirFor(modelDir, spec))).toBe(false);
    await expect(removeModel(modelDir, spec)).resolves.toBeUndefined();
  });
});
