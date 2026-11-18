// a cloud that answers as a case scripts it and records what it was asked: each call's answer is
// the script's, a thrown error included, and a file's settle meets the answer the script gives, so
// a case says how the cloud met a save; and the browser's sign-in as a case sets it

import { createHash } from "node:crypto";

import { createORPCErrorFromJson, RPCSerializer } from "@orpc/client";
import { V1_RPC_PATH } from "@repo/contract/rpc/v1-contract";
import type { V1Client } from "@repo/contract/rpc/v1-contract";
import { z } from "zod";

import type { Cloud, FileCreate, LinkSave, PageSave, Saved } from "../cloud";
import type { Connection } from "../connection";
import type { Session, SignIn } from "../sign-in";

export const SESSION: Session = {
  bearer: "session-token.signature",
  email: "reader@example.test",
  origin: "http://localhost:5174",
};

export const SIGNED_IN: SignIn = { kind: "signed-in", session: SESSION };
export const SIGNED_OUT: SignIn = { email: SESSION.email, kind: "signed-out" };

// another account, signed in on the same site under a cookie of its own
export const OTHER_SESSION: Session = {
  ...SESSION,
  bearer: "other-token.signature",
  email: "other@example.test",
};

// what a browser keeps of the account the cloud read a cookie as
export const keptAs = (email: string, cookie: string): Connection => ({
  cookie: createHash("sha256").update(cookie).digest("hex"),
  email,
});
export const KEPT = keptAs(SESSION.email, SESSION.bearer);

export const savedAs = (title: string, created = true): Saved => ({
  created,
  item: { card: { title } },
});

type Answer<T> = () => Promise<T>;

const reserveSchema = z.object({ mime: z.string(), sha: z.string() });

type Files = V1Client["library"]["files"];
type FileAnswer = Awaited<ReturnType<Files["reserve"]>> | Awaited<ReturnType<Files["settle"]>>;

// a refusal as `/v1/rpc` answers one: a code a row declares arrives defined, any other not, and its
// words are its code where the case names none
export const refusal =
  (code: string, defined = true, message = code): Answer<never> =>
  async () => {
    throw createORPCErrorFromJson({ code, data: undefined, defined, message });
  };

export interface FakeCloud {
  readonly cloud: Cloud;
  readonly saves: PageSave[];
  readonly links: LinkSave[];
  readonly files: FileCreate[];
  readonly uploads: { readonly bytes: Uint8Array; readonly mime: string; readonly sha: string }[];
}

export const fakeCloud = (script: {
  save?: Answer<Saved>;
  saveLink?: Answer<Saved>;
  createFile?: Answer<Pick<Saved, "item">>;
  // what a file's settle is answered with, once its bytes went to the store, a kept file's where the
  // case names nothing
  upload?: Answer<Response>;
}): FakeCloud => {
  const serializer = new RPCSerializer();
  const answered = (output: FileAnswer): Response => Response.json(serializer.serialize(output));
  // the file each upload was reserved for, by the path its bytes go to
  const reserved = new Map<string, { readonly mime: string; readonly sha: string }>();
  const fake: FakeCloud = {
    cloud: {
      createFile: async (input) => {
        fake.files.push(input);
        return await (script.createFile ?? (async () => savedAs("Picture")))();
      },
      keepAwake: () => {},
      save: async (input) => {
        fake.saves.push(input);
        return await (script.save ?? (async () => savedAs(input.title)))();
      },
      saveLink: async (input) => {
        fake.links.push(input);
        return await (script.saveLink ?? (async () => savedAs(input.title ?? input.url)))();
      },
      transport: {
        fetch: async (request) => {
          const { pathname } = new URL(request.url);
          if (pathname === `${V1_RPC_PATH}/library/files/reserve`) {
            const { mime, sha } = reserveSchema.parse(serializer.deserialize(await request.json()));
            const url = `/store/${sha}`;
            reserved.set(url, { mime, sha });
            return answered({
              headers: { "content-type": mime },
              kind: "upload",
              uploadId: sha,
              url,
            });
          }
          if (pathname === `${V1_RPC_PATH}/library/files/settle`) {
            return await (script.upload ?? (async () => answered({ kind: "kept" })))();
          }
          const file = reserved.get(pathname);
          if (request.method !== "PUT" || file === undefined) {
            return new Response(null, { status: 404 });
          }
          fake.uploads.push({
            bytes: new Uint8Array(await request.arrayBuffer()),
            mime: request.headers.get("content-type") ?? "",
            sha: file.sha,
          });
          return new Response(null, { status: 200 });
        },
        origin: SESSION.origin,
      },
    },
    files: [],
    links: [],
    saves: [],
    uploads: [],
  };
  return fake;
};
