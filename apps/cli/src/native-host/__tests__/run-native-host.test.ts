import { describe, expect, it } from "vitest";
import { runCliForTest } from "../../__tests__/run-cli";

describe("the native-host leaf", () => {
  // PIVOT-STUB(X): replaced by the frames and run-native-host suites (§8.7)
  it("answers its exit code through the leaf, and writes nothing to stdout", async () => {
    const result = await runCliForTest({
      argv: ["native-host", "chrome-extension://not-the-extension/"],
      baseUrl: null,
    });
    expect(result).toEqual({ code: 1, stderr: "", stdout: "" });
    expect(process.exitCode).toBeUndefined();
  });
});
