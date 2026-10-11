// every request an install sends names the build that sent it, so the Worker can refuse one older
// than what it answers now: a shape retires by raising the floor past every build that reads it,
// never while one of them can still reach the wire. the platform is telemetry, never a gate.

export const CLIENT_BUILD_HEADER = "x-inteligir-build";

export type ClientPlatform = "desktop" | "mobile";

export interface ClientBuild {
  version: string;
  platform: ClientPlatform;
}

// semver's build-metadata slot, which no precedence reads
export const clientBuildValue = (build: ClientBuild): string =>
  `${build.version}+${build.platform}`;

export const clientBuildHeaders = (build: ClientBuild) => ({
  [CLIENT_BUILD_HEADER]: clientBuildValue(build),
});

export interface BuildVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: boolean;
}

const CORE = String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)`;
const RELEASE_PATTERN = new RegExp(`^${CORE}$`, "u");
const HEADER_PATTERN = new RegExp(
  String.raw`^${CORE}(-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\+[0-9A-Za-z-]+$`,
  "u",
);

const versionOf = (match: RegExpExecArray, prerelease: boolean): BuildVersion => ({
  major: Number(match[1]),
  minor: Number(match[2]),
  patch: Number(match[3]),
  prerelease,
});

// a floor names a release: "below 0.7.0-beta" would need a prerelease order no floor is worth
export const parseReleaseVersion = (text: string): BuildVersion | null => {
  const match = RELEASE_PATTERN.exec(text);
  return match === null ? null : versionOf(match, false);
};

// null for an absent or malformed header, which the floor refuses as it does a stale build
export const parseClientBuildHeader = (header: string | null): BuildVersion | null => {
  if (header === null) {
    return null;
  }
  const match = HEADER_PATTERN.exec(header);
  return match === null ? null : versionOf(match, match[4] !== undefined);
};

// a prerelease sits below its release, so a beta of the floor's own version is under it
export const meetsBuildFloor = (build: BuildVersion, floor: BuildVersion): boolean => {
  const order = build.major - floor.major || build.minor - floor.minor || build.patch - floor.patch;
  return order === 0 ? !build.prerelease : order > 0;
};
