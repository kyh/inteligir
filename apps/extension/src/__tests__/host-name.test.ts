import { DEV_NATIVE_HOST_NAME } from "@repo/contract/browser/extension-identity";
import { describe, expect, it } from "vitest";

import { nativeHostName } from "../background/host-name";

describe("the host the service worker dials", () => {
  it("is the one the build defines, the dev host for the suites as for `--mode dev`", () => {
    expect(nativeHostName()).toBe(DEV_NATIVE_HOST_NAME);
  });
});
