import { clientBuildHeaders } from "@repo/contract/client-build";
import { fileSha } from "@repo/contract/library/file-sha";
import { outcomeOf, uploadBlob, v1Client } from "@repo/contract/rpc/call-outcome";
import type { V1Transport } from "@repo/contract/rpc/call-outcome";
import type { V1Client } from "@repo/contract/rpc/v1-contract";

import { CALL_DEADLINE_MS } from "./connection";
import type { Session } from "./sign-in";

type Items = V1Client["library"]["items"];

export type PageSave = Parameters<Items["save"]>[0];

export type LinkSave = Parameters<Items["saveLink"]>[0];

export type FileCreate = Parameters<Items["createFile"]>[0];

export interface Saved {
  readonly created: boolean;
  readonly item: { readonly card: { readonly title: string } };
}

export interface Cloud {
  readonly save: (input: PageSave) => Promise<Saved>;
  readonly saveLink: (input: LinkSave) => Promise<Saved>;
  readonly createFile: (input: FileCreate) => Promise<Pick<Saved, "item">>;
  readonly transport: V1Transport;
  readonly keepAwake: () => void;
}

const KEEP_AWAKE_MS = 5000;

export const cloudOf = (session: Session, version: string, keepAwake: () => void) => {
  const headers = {
    ...clientBuildHeaders({ platform: "extension", version }),
    authorization: `Bearer ${session.bearer}`,
  };

  const transport: V1Transport = {
    fetch: async (request) => {
      const signed = new Headers(request.headers);

      for (const [name, value] of Object.entries(headers)) {
        signed.set(name, value);
      }

      return await fetch(
        new Request(request, { headers: signed, signal: AbortSignal.timeout(CALL_DEADLINE_MS) }),
      );
    },
    origin: session.origin,
  };

  const { items } = v1Client(transport).library;

  return {
    createFile: async (input) => await items.createFile(input),
    keepAwake,
    save: async (input) => await items.save(input),
    saveLink: async (input) => await items.saveLink(input),
    transport,
  } satisfies Cloud;
};

export const sendFile = async (cloud: Cloud, bytes: Uint8Array<ArrayBuffer>, mime: string) => {
  const sha = fileSha(bytes);
  const awake = setInterval(cloud.keepAwake, KEEP_AWAKE_MS);

  try {
    return await outcomeOf(async () => {
      await uploadBlob(cloud.transport, { bytes, mime, sha });

      return sha;
    });
  } finally {
    clearInterval(awake);
  }
};
