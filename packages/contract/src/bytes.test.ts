import { describe, expect, it } from "vitest";
import { base64FromBytes, bytesFromBase64 } from "./bytes";

describe(bytesFromBase64, () => {
  it("reads back every byte base64FromBytes wrote, the high half included", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(bytesFromBase64(base64FromBytes(bytes))).toStrictEqual(bytes);
    expect(bytesFromBase64("")).toStrictEqual(new Uint8Array());
  });
});
