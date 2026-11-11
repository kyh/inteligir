// `/v1` as this phone reaches it: the cloud's origin over the global fetch, the build on every
// request, since the Worker meets every install at its build floor, and the session cookie the
// phone keeps, under its app scheme in `expo-origin`, the door the Worker reads a phone's cookie
// by. Every call, upload and download goes through it. No Blob or File crosses it: a file's bytes
// go as a Uint8Array.

import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { clientBuildValue, CLIENT_BUILD_HEADER } from "@repo/contract/client-build";
import type { ClientBuild } from "@repo/contract/client-build";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import { sharedFailure } from "@repo/contract/library/call-outcome";
import type { SessionEnd, V1Transport } from "@repo/contract/library/call-outcome";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { V1_RPC_PATH } from "@repo/contract/v1";
import type { V1Client } from "@repo/contract/v1";
import { keptFileType } from "@repo/contract/items/item-kind";
import type { HeldFile } from "../files/file-cache";

export const phoneTransport = (args: {
  readonly origin: string;
  readonly build: ClientBuild;
  // read at each request: the Keychain's, as Better Auth's Expo client keeps it
  readonly cookie: () => Promise<string | null>;
  readonly fetch: (request: Request) => Promise<Response>;
}): V1Transport => ({
  fetch: async (request) => {
    const headers = new Headers(request.headers);
    headers.set(CLIENT_BUILD_HEADER, clientBuildValue(args.build));
    headers.set("expo-origin", PHONE_ORIGIN);
    const cookie = await args.cookie();
    if (cookie !== null) {
      headers.set("cookie", cookie);
    }
    // the cookie is the one set here: the system's own cookie handling neither overrides it nor
    // keeps what the cloud sets, which a socket's upgrade would then carry
    return await args.fetch(new Request(request, { credentials: "omit", headers }));
  },
  origin: args.origin,
});

// how a call's failure ended the phone's sign-in, if it did
const sessionEndOf = (cause: unknown): SessionEnd | null => {
  const failure = cause instanceof Error ? sharedFailure(cause) : null;
  return failure?.kind === "session" ? failure.end : null;
};

// the cell's calls over the transport; the link hears every call's failure once, before its
// caller does, so a sign-in the cloud ended is answered whichever call met it
export const v1ClientOver = (
  transport: V1Transport,
  onSessionEnd: (end: SessionEnd) => void,
): V1Client =>
  createORPCClient<V1Client>(
    new RPCLink({
      fetch: async (url, init) => await transport.fetch(new Request(url, init)),
      interceptors: [
        onError((cause: unknown) => {
          const end = sessionEndOf(cause);
          if (end !== null) {
            onSessionEnd(end);
          }
        }),
      ],
      origin: transport.origin,
      url: V1_RPC_PATH,
    }),
  );

// a file's bytes from `/v1/blobs/<sha>`, checked against the hash it is named by, and the type the
// cloud serves it as, the one it was kept as; null when the cloud holds none
export const downloadBlob = async (
  transport: V1Transport,
  sha256Hex: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>,
  sha: string,
): Promise<HeldFile | null> => {
  const response = await transport.fetch(new Request(`${transport.origin}${V1_BLOBS_PATH}/${sha}`));
  if (response.status === 404) {
    await response.arrayBuffer();
    return null;
  }
  if (!response.ok) {
    await response.arrayBuffer();
    throw new Error(`The library's file did not come (${String(response.status)}).`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if ((await sha256Hex(bytes)) !== sha) {
    throw new Error("The library's file came changed on the way.");
  }
  return { bytes, mime: keptFileType(response.headers.get("content-type") ?? "") };
};
