import { createHash } from "node:crypto";

import { createORPCErrorFromJson, RPCSerializer } from "@orpc/client";
import { deferred } from "@repo/contract/deferred";
import type { Deferred } from "@repo/contract/deferred";
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

export const OTHER_SESSION: Session = {
  ...SESSION,
  bearer: "other-token.signature",
  email: "other@example.test",
};

export const keptAs = (email: string, cookie: string) =>
  ({
    cookie: createHash("sha256").update(cookie).digest("hex"),
    email,
  }) satisfies Connection;

export const KEPT = keptAs(SESSION.email, SESSION.bearer);

export const savedAs = (title: string, created = true) =>
  ({
    created,
    item: { card: { title } },
  }) satisfies Saved;

type Answer<T> = () => Promise<T>;

const reserveSchema = z.object({ mime: z.string(), sha: z.string() });

type Files = V1Client["library"]["files"];

type FileAnswer = Awaited<ReturnType<Files["reserve"]>> | Awaited<ReturnType<Files["settle"]>>;

export const refusal = (code: string, defined = true, message = code) =>
  (async () => {
    throw createORPCErrorFromJson({ code, data: undefined, defined, message });
  }) satisfies Answer<never>;

export interface FakeCloud {
  readonly cloud: Cloud;
  readonly saves: PageSave[];
  readonly links: LinkSave[];
  readonly linked: (count: number) => Promise<void>;
  readonly files: FileCreate[];
  readonly uploads: { readonly bytes: Uint8Array; readonly mime: string; readonly sha: string }[];
}

export const fakeCloud = (script: {
  save?: Answer<Saved>;
  saveLink?: Answer<Saved>;
  createFile?: Answer<Pick<Saved, "item">>;
  upload?: Answer<Response>;
}) => {
  const serializer = new RPCSerializer();
  const answered = (output: FileAnswer) => Response.json(serializer.serialize(output));
  const reserved = new Map<string, { readonly mime: string; readonly sha: string }>();
  const waits: { readonly count: number; readonly heard: Deferred<void> }[] = [];

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

        for (const wait of waits) {
          if (fake.links.length >= wait.count) {
            wait.heard.resolve();
          }
        }

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
    linked: async (count) => {
      const heard = deferred();
      waits.push({ count, heard });

      if (fake.links.length >= count) {
        heard.resolve();
      }

      await heard.promise;
    },
    links: [],
    saves: [],
    uploads: [],
  };

  return fake;
};
