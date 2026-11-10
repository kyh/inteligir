// a cloud that answers as a case scripts it and records what it was asked: each call's answer is
// the script's, a thrown error included, and a file's bytes meet the status the script answers, so
// a case says how the cloud met a save; and the browser's sign-in as a case sets it

import { createORPCErrorFromJson } from "@orpc/client";
import { V1_BLOBS_PATH } from "@repo/contract/library/library-blobs";

import type { Cloud, FileCreate, LinkSave, PageSave, Saved } from "../cloud";
import type { Session, SignIn } from "../sign-in";

export const SESSION: Session = {
  bearer: "session-token.signature",
  email: "reader@example.test",
  origin: "http://localhost:5174",
};

export const SIGNED_IN: SignIn = { kind: "signed-in", session: SESSION };
export const SIGNED_OUT: SignIn = { email: SESSION.email, kind: "signed-out" };

// another account, signed in on the same site
export const OTHER_SESSION: Session = { ...SESSION, email: "other@example.test" };

export const savedAs = (title: string, created = true): Saved => ({
  created,
  item: { fields: { title } },
});

type Answer<T> = () => Promise<T>;

// a refusal as `/v1/rpc` answers one: a code a row declares arrives defined, any other not
export const refusal =
  (code: string, defined = true): Answer<never> =>
  async () => {
    throw createORPCErrorFromJson({ code, data: undefined, defined, message: code });
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
  // what `/v1/blobs` answers a file's bytes with, a stored file's where the case names nothing
  upload?: Answer<Response>;
}): FakeCloud => {
  const fake: FakeCloud = {
    cloud: {
      createFile: async (input) => {
        fake.files.push(input);
        return await (script.createFile ?? (async () => savedAs("Picture")))();
      },
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
          fake.uploads.push({
            bytes: new Uint8Array(await request.arrayBuffer()),
            mime: request.headers.get("content-type") ?? "",
            sha: new URL(request.url).pathname.replace(`${V1_BLOBS_PATH}/`, ""),
          });
          return await (script.upload ?? (async () => new Response(null, { status: 201 })))();
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
