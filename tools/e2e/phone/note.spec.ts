import path from "node:path";
import { expect } from "@playwright/test";
import { markdownOf, test } from "../src/fixtures";
import { buildCloudPort, openPhone } from "./simulator";

const NOTE_FLOW = path.join(import.meta.dirname, "note.yaml");

test.use({ cloudPort: buildCloudPort() });

test("the phone signs in, and what it types into a note the library holds", async ({
  account,
  library,
}) => {
  const title = "Phone plans";
  const typed = "Typed on the phone";
  const { item } = await library.items.createNote({ markdown: "A line to type after.\n", title });
  const phone = await openPhone();
  try {
    await phone.run(NOTE_FLOW, {
      EMAIL: account.email,
      PASSWORD: account.password,
      TITLE: title,
      TYPED: typed,
    });
    await expect.poll(async () => await markdownOf(library, item.id)).toContain(typed);
  } finally {
    await phone.close();
  }
});
