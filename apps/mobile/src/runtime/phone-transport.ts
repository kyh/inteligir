import { clientBuildValue, CLIENT_BUILD_HEADER } from "@repo/contract/client-build";
import type { ClientBuild } from "@repo/contract/client-build";
import { PHONE_ORIGIN } from "@repo/contract/origin";
import type { V1Transport } from "@repo/contract/rpc/call-outcome";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";
import { keptFileType } from "@repo/contract/items/item-kind";
import type { HeldFile } from "../files/file-cache";

export const phoneTransport = (args: {
  readonly origin: string;
  readonly build: ClientBuild;
  readonly cookie: () => Promise<string | null>;
  readonly fetch: (request: Request) => Promise<Response>;
}) =>
  ({
    fetch: async (request) => {
      const headers = new Headers(request.headers);
      headers.set(CLIENT_BUILD_HEADER, clientBuildValue(args.build));
      headers.set("expo-origin", PHONE_ORIGIN);
      const cookie = await args.cookie();

      if (cookie !== null) {
        headers.set("cookie", cookie);
      }

      return await args.fetch(new Request(request, { credentials: "omit", headers }));
    },
    origin: args.origin,
  }) satisfies V1Transport;

export const downloadBlob = async (
  transport: V1Transport,
  sha256Hex: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>,
  sha: string,
) => {
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

  return {
    bytes,
    mime: keptFileType(response.headers.get("content-type") ?? ""),
  } satisfies HeldFile | null;
};
