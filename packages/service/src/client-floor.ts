import {
  CLIENT_BUILD_HEADER,
  meetsBuildFloor,
  parseClientBuildHeader,
  parseReleaseVersion,
} from "@repo/contract/client-build";
import type { BuildVersion } from "@repo/contract/client-build";

// the oldest build /v1 answers. a wire shape retires by raising it past every build that reads the
// shape, so what may change under an install is held to the builds above it
export const buildFloor = (env: Env): BuildVersion => {
  const floor = parseReleaseVersion(env.MIN_CLIENT_BUILD);
  if (floor === null) {
    throw new Error(`MIN_CLIENT_BUILD must be a release version, not "${env.MIN_CLIENT_BUILD}"`);
  }
  return floor;
};

// an absent or unreadable header is refused like a stale build: every build that sends none is
// older than the floor
export const isBelowFloor = (request: Request, floor: BuildVersion): boolean => {
  const build = parseClientBuildHeader(request.headers.get(CLIENT_BUILD_HEADER));
  return build === null || !meetsBuildFloor(build, floor);
};
