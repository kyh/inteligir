// a cloud that answers as a case scripts it and records what it was asked: each call's answer is
// the script's, a thrown error included, so a case says how the cloud met a save; and the browser's
// sign-in as a case sets it

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

export interface FakeCloud {
  readonly cloud: Cloud;
  readonly saves: PageSave[];
  readonly links: LinkSave[];
  readonly files: FileCreate[];
  readonly uploads: { readonly bytes: Uint8Array; readonly mime: string }[];
}

export const fakeCloud = (script: {
  save?: Answer<Saved>;
  saveLink?: Answer<Saved>;
  createFile?: Answer<Pick<Saved, "item">>;
  putFile?: Answer<string>;
}): FakeCloud => {
  const fake: FakeCloud = {
    cloud: {
      createFile: async (input) => {
        fake.files.push(input);
        return await (script.createFile ?? (async () => savedAs("Picture")))();
      },
      putFile: async (bytes, mime) => {
        fake.uploads.push({ bytes, mime });
        return await (script.putFile ?? (async () => "c".repeat(64)))();
      },
      save: async (input) => {
        fake.saves.push(input);
        return await (script.save ?? (async () => savedAs(input.title)))();
      },
      saveLink: async (input) => {
        fake.links.push(input);
        return await (script.saveLink ?? (async () => savedAs(input.title ?? input.url)))();
      },
    },
    files: [],
    links: [],
    saves: [],
    uploads: [],
  };
  return fake;
};
