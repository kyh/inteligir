import { apiRoutes } from "@repo/server-contract/routes";

import type { TypedRoutesRegistrars } from "@repo/typed-routes/typed-routes";
import type { NoteIntelligence } from "./note-intelligence";

export function registerNoteIntelligenceRoutes(
  registrars: Pick<TypedRoutesRegistrars, "get" | "post">,
  service: NoteIntelligence,
): void {
  const { get, post } = registrars;

  get(apiRoutes.noteIntelligence.status, (c) => c.json(service.status()));

  post(apiRoutes.noteIntelligence.toggle, (c, body) => c.json(service.setEnabled(body.enabled)));
}
