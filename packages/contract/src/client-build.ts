export const CLIENT_BUILD_HEADER = "x-inteligir-build";

type ClientPlatform = "extension" | "mobile";

export interface ClientBuild {
  version: string;
  platform: ClientPlatform;
}

export const clientBuildValue = (build: ClientBuild) => `${build.version}+${build.platform}`;

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

const versionOf = (match: RegExpExecArray, prerelease: boolean) =>
  ({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
  }) satisfies BuildVersion;

export const parseReleaseVersion = (text: string) => {
  const match = RELEASE_PATTERN.exec(text);

  return match === null ? null : versionOf(match, false);
};

export const parseClientBuildHeader = (header: string | null) => {
  if (header === null) {
    return null;
  }

  const match = HEADER_PATTERN.exec(header);

  return match === null ? null : versionOf(match, match[4] !== undefined);
};

export const meetsBuildFloor = (build: BuildVersion, floor: BuildVersion) => {
  const order = build.major - floor.major || build.minor - floor.minor || build.patch - floor.patch;

  return order === 0 ? !build.prerelease : order > 0;
};
