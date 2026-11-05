// a cloud that answers as a case scripts it and records what it was asked: each call's answer is
// the script's, a thrown error included, so a case says how the cloud met a save

import type { Cloud, FileCreate, LinkSave, PageSave, Saved } from "../cloud";
import type { Connection } from "../connection";

export const CONNECTION: Connection = {
  credential: `igd_${"a".repeat(64)}`,
  deviceId: "extension-device",
  email: "reader@example.test",
  origin: "http://localhost:5174",
  userId: "reader",
};

export const savedAs = (title: string, folded = false): Saved => ({
  folded,
  item: { fields: { title } },
});

type Answer<T> = () => Promise<T>;

export interface FakeCloud {
  readonly cloud: Cloud;
  readonly saves: PageSave[];
  readonly links: LinkSave[];
  readonly files: FileCreate[];
  readonly uploads: { readonly bytes: Uint8Array; readonly mime: string }[];
  signOuts: number;
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
      signOut: async () => {
        fake.signOuts += 1;
      },
    },
    files: [],
    links: [],
    saves: [],
    signOuts: 0,
    uploads: [],
  };
  return fake;
};
