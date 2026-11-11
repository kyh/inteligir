// Every path a door answers, spelled as the Start file route that hands it to its door spells its
// id, `$` a splat (apps/web/src/routes, one route file to each row). The suites' Worker dispatches
// by this table too (`./test-support/test-worker.ts`), and each door refuses a path the table does
// not give it. An installed build and an assistant's grant name these paths, so none moves.

import { AUTH_API_PATHS } from "@repo/contract/account/account-schema";
import { CONNECTOR_PATH } from "@repo/contract/connector";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { V1_NOTES_PATH, V1_SOCKET_PATH } from "@repo/contract/library/library-socket";
import { V1_RPC_PATH } from "@repo/contract/v1";
import type { DoorName } from "./doors-api";

const SPLAT = "$";

export const DOOR_ROUTES = {
  // Better Auth's own, at its default base path
  auth: `/api/auth/${SPLAT}`,
  signUp: AUTH_API_PATHS.signUp,
  rpc: `${V1_RPC_PATH}/${SPLAT}`,
  blobs: `${V1_BLOBS_PATH}/${SPLAT}`,
  socket: V1_SOCKET_PATH,
  note: `${V1_NOTES_PATH}/${SPLAT}`,
  connector: CONNECTOR_PATH,
  // the connector's RFC 9728 document, and the authorization server's RFC 8414 one
  connectorMetadata: `/.well-known/oauth-protected-resource${CONNECTOR_PATH}`,
  authorizationServerMetadata: "/.well-known/oauth-authorization-server",
  oauthToken: "/oauth/token",
  oauthRegister: "/oauth/register",
  // the person's own page, which signs them in and asks
  consent: "/connect/authorize",
} as const satisfies Record<DoorName, string>;

const isDoorName = (key: string): key is DoorName => Object.hasOwn(DOOR_ROUTES, key);

const DOOR_NAMES = Object.keys(DOOR_ROUTES).filter(isDoorName);

// a splat holds what lies under its prefix and never the prefix bare, which Start's splat route
// takes too
const reaches = (route: string, pathname: string): boolean =>
  route.endsWith(`/${SPLAT}`)
    ? pathname.startsWith(route.slice(0, -SPLAT.length))
    : pathname === route;

export const doorAt = (pathname: string): DoorName | undefined =>
  DOOR_NAMES.find((name) => reaches(DOOR_ROUTES[name], pathname));
