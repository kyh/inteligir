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
  fileURLToPath(new URL("./fixtures/test-model.tar.bz2", import.meta.url)),
);

function specFor(archive: Buffer): VoiceModelSpec {
  return {
    id: "test-model",
    label: "Test model",
    sizeBytes: archive.byteLength,
    sha256: createHash("sha256").update(archive).digest("hex"),
    url: "https://models.test/model.tar.bz2",
    files: {
      encoder: "encoder.onnx",
      decoder: "decoder.onnx",
      joiner: "joiner.onnx",
      tokens: "tokens.txt",
    },
  };
}

// two chunks, so progress is observable.
function fetchServing(body: Buffer): typeof fetch {
  return async () =>
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
}

describe("downloadModel", () => {
  it("extracts every model file, drops the rest, and reports progress to the size", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(FIXTURE);
    const progress: number[] = [];
    await downloadModel({
      modelDir,
      spec,
      signal: new AbortController().signal,
      onProgress: (received) => progress.push(received),
      fetchImpl: fetchServing(FIXTURE),
    });

    const files = resolveModelFiles(modelDir, spec);
    expect(readFileSync(files.encoder, "utf8")).toBe("encoder-bytes");
    expect(readFileSync(files.tokens, "utf8")).toBe("a b c\n");
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
        modelDir,
        spec,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: fetchServing(tampered),
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
        modelDir,
        spec,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: fetchServing(Buffer.concat([FIXTURE, Buffer.alloc(1024)])),
      }),
    ).rejects.toThrow(/larger than/u);
    expect(await isModelInstalled(modelDir, spec)).toBe(false);
  });

  it("refuses a truncated body", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    const spec = specFor(FIXTURE);
    await expect(
      downloadModel({
        modelDir,
        spec,
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: fetchServing(FIXTURE.subarray(0, 32)),
      }),
    ).rejects.toThrow(/not the/u);
    expect(await isModelInstalled(modelDir, spec)).toBe(false);
  });

  it("says which host it could not reach", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    await expect(
      downloadModel({
        modelDir,
        spec: specFor(FIXTURE),
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: async () => {
          throw new Error("getaddrinfo ENOTFOUND");
        },
      }),
    ).rejects.toThrow(/models\.test/u);
  });

  it("answers a non-2xx with its status", async () => {
    const modelDir = makeTempDir("inteligir-models-");
    await expect(
      downloadModel({
        modelDir,
        spec: specFor(FIXTURE),
        signal: new AbortController().signal,
        onProgress: () => undefined,
        fetchImpl: async () => new Response("gone", { status: 404 }),
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
      modelDir,
      spec,
      signal: new AbortController().signal,
      onProgress: () => undefined,
      fetchImpl: fetchServing(FIXTURE),
    });
    expect(await isModelInstalled(modelDir, spec)).toBe(true);

    await removeModel(modelDir, spec);
    expect(existsSync(modelDirFor(modelDir, spec))).toBe(false);
    await expect(removeModel(modelDir, spec)).resolves.toBeUndefined();
  });
});
