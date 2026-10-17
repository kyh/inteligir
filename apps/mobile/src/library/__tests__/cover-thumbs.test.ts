import { describe, expect, it } from "vitest";
import { deferred, nextTask } from "../../__tests__/async";
import { createCoverThumbs, THUMB_MIN_BYTES, THUMB_WIDTH, thumbNameOf } from "../cover-thumbs";
import type { CoverThumbPort, HeldOriginal } from "../cover-thumbs";

// the attachments folder, its originals' sizes, and every call the thumbnails made of it
const fakePort = (sizes: Record<string, number>) => {
  const made = new Map<string, string>();
  const calls: string[] = [];
  let shrinking = 0;
  let mostShrinking = 0;
  const gates: (() => void)[] = [];
  const port: CoverThumbPort = {
    find: async (name) => {
      calls.push(`find ${name}`);
      return made.get(name) ?? null;
    },
    original: async (path): Promise<HeldOriginal> => {
      calls.push(`original ${path}`);
      const size = sizes[path];
      return size === undefined
        ? { message: "offline", ok: false }
        : { ok: true, uri: `file:///a/${path}.jpg` };
    },
    shrink: async (uri, name, width) => {
      calls.push(`shrink ${uri} ${name} ${String(width)}`);
      shrinking += 1;
      mostShrinking = Math.max(mostShrinking, shrinking);
      const gate = deferred();
      gates.push(gate.resolve);
      await gate.promise;
      shrinking -= 1;
      const thumb = `file:///a/${name}`;
      made.set(name, thumb);
      return thumb;
    },
    size: async (uri) => sizes[uri.slice("file:///a/".length, -".jpg".length)] ?? 0,
  };
  return { calls, gates, mostShrinking: () => mostShrinking, port };
};

describe("a card's cover", () => {
  it("draws a small original as it is", async () => {
    const { calls, port } = fakePort({ small: THUMB_MIN_BYTES });
    expect(await createCoverThumbs(port).thumbFor("small")).toBe("file:///a/small.jpg");
    expect(calls).toStrictEqual(["original small"]);
  });

  it("shrinks a big one once, to a 320 px JPEG named by the original beside it, and finds it after", async () => {
    const fake = fakePort({ big: THUMB_MIN_BYTES + 1 });
    const thumbs = createCoverThumbs(fake.port);
    const first = thumbs.thumbFor("big");
    const second = thumbs.thumbFor("big");
    await nextTask();
    for (const open of fake.gates) {
      open();
    }
    expect(await first).toBe("file:///a/big.thumb.jpg");
    expect(await second).toBe("file:///a/big.thumb.jpg");
    expect(await thumbs.thumbFor("big")).toBe("file:///a/big.thumb.jpg");
    expect(fake.calls.filter((call) => call.startsWith("shrink"))).toStrictEqual([
      `shrink file:///a/big.jpg big.thumb.jpg ${String(THUMB_WIDTH)}`,
    ]);
  });

  it("answers null for a cover not on this phone, and asks again next time", async () => {
    const { calls, port } = fakePort({});
    const thumbs = createCoverThumbs(port);
    expect(await thumbs.thumbFor("offline")).toBeNull();
    expect(await thumbs.thumbFor("offline")).toBeNull();
    expect(calls).toStrictEqual(["original offline", "original offline"]);
  });

  it("works on at most four covers at once", async () => {
    const sizes = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`c${String(i)}`, THUMB_MIN_BYTES + 1]),
    );
    const fake = fakePort(sizes);
    const thumbs = createCoverThumbs(fake.port);
    const all = Object.keys(sizes).map(async (path) => await thumbs.thumbFor(path));
    for (let round = 0; round < 20; round += 1) {
      await nextTask();
      for (const open of fake.gates.splice(0)) {
        open();
      }
    }
    expect(await Promise.all(all)).toHaveLength(10);
    expect(fake.mostShrinking()).toBe(4);
  });

  it("names a thumbnail by its original's cache name", () => {
    expect(thumbNameOf("file:///var/cache/attachments/3f9a0c2b1d4e5f6071.png")).toBe(
      "3f9a0c2b1d4e5f6071.thumb.jpg",
    );
  });
});
