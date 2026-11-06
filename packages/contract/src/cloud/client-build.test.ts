import { describe, expect, it } from "vitest";
import {
  CLIENT_BUILD_HEADER,
  clientBuildHeaders,
  meetsBuildFloor,
  parseClientBuildHeader,
  parseReleaseVersion,
} from "./client-build";
import type { BuildVersion, ClientBuild } from "./client-build";

const BUILD: ClientBuild = { platform: "mobile", version: "0.7.0" };
const SENT = "0.7.0+mobile";

const release = (text: string): BuildVersion => {
  const parsed = parseReleaseVersion(text);
  if (parsed === null) {
    throw new Error(`${text} is no release`);
  }
  return parsed;
};

const meets = (header: string, floor: string): boolean => {
  const build = parseClientBuildHeader(header);
  return build !== null && meetsBuildFloor(build, release(floor));
};

describe("the build header", () => {
  it("says the version and the platform in semver's build-metadata slot", () => {
    expect(clientBuildHeaders(BUILD)).toStrictEqual({ [CLIENT_BUILD_HEADER]: SENT });
    expect(parseClientBuildHeader(SENT)).toStrictEqual({
      major: 0,
      minor: 7,
      patch: 0,
      prerelease: false,
    });
  });

  it("reads a platform it does not know, since the platform gates nothing", () => {
    expect(parseClientBuildHeader("0.7.0+android")).not.toBeNull();
  });

  it("refuses what is absent or not that grammar", () => {
    for (const header of [null, "", "0.7.0", "0.7+mobile", "v0.7.0+mobile", "07.0.0+mobile"]) {
      expect(parseClientBuildHeader(header), String(header)).toBeNull();
    }
  });

  it("holds a floor to a release", () => {
    expect(parseReleaseVersion("0.7.0")).not.toBeNull();
    expect(parseReleaseVersion("0.7.0-beta.1")).toBeNull();
    expect(parseReleaseVersion("0.7.0+mobile")).toBeNull();
  });

  it("admits a build at or above the floor, and a prerelease only past its release", () => {
    expect(meets("0.7.0+mobile", "0.7.0")).toBe(true);
    expect(meets("0.7.1+desktop", "0.7.0")).toBe(true);
    expect(meets("1.0.0+desktop", "0.7.0")).toBe(true);
    expect(meets("0.10.0+desktop", "0.9.0")).toBe(true);
    expect(meets("0.6.9+desktop", "0.7.0")).toBe(false);
    expect(meets("0.7.0-beta.1+desktop", "0.7.0")).toBe(false);
    expect(meets("0.7.1-beta.1+desktop", "0.7.0")).toBe(true);
  });
});
