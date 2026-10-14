import {
  CLIENT_BUILD_HEADER,
  meetsBuildFloor,
  parseClientBuildHeader,
  parseReleaseVersion,
} from "@repo/contract/cloud/client-build";
import type { BuildVersion } from "@repo/contract/cloud/client-build";
import { refuse } from "./cloud-http";

// the oldest build /v1 answers. a wire shape retires by raising it past every build that reads the
// shape, so what may change under an install is held to the builds above it
const buildFloor = (env: Env): BuildVersion => {
  const floor = parseReleaseVersion(env.MIN_CLIENT_BUILD);
  if (floor === null) {
    throw new Error(`MIN_CLIENT_BUILD must be a release version, not "${env.MIN_CLIENT_BUILD}"`);
  }
  return floor;
};

// a page this Worker served ships in this deploy, so it is never below the floor. a browser marks
// the requests its pages make same-origin, a header no page script can set and no install sends
const fromOwnPage = (request: Request): boolean =>
  request.headers.get("sec-fetch-site") === "same-origin";

const OUTDATED_MESSAGE = "This version of Inteligir can't sync anymore. Update it to keep syncing.";

// git prints a text/plain refusal's body as `remote:` lines, and the status is what the engine reads
const OUTDATED_GIT_TEXT =
  "this version of inteligir is older than the hosted vault accepts; update it\n";

// null when the request may go on. an absent or unreadable header is refused like a stale build:
// every build that sends none is older than the floor
export const refuseBelowFloor = (
  request: Request,
  env: Env,
  speaksEnvelope: boolean,
): Response | null => {
  const floor = buildFloor(env);
  if (fromOwnPage(request)) {
    return null;
  }
  const build = parseClientBuildHeader(request.headers.get(CLIENT_BUILD_HEADER));
  if (build !== null && meetsBuildFloor(build, floor)) {
    return null;
  }
  return speaksEnvelope
    ? refuse("client-outdated", OUTDATED_MESSAGE)
    : new Response(OUTDATED_GIT_TEXT, { status: 426 });
};
