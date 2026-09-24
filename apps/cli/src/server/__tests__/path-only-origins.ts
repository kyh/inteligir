import type { ThreadOrigins } from "../threads/thread-origins";

// a service with no vault behind it: every origin is the path it was composed at
export const pathOnlyOrigins: ThreadOrigins = {
  noteIdAt: async () => null,
  pathForNoteId: async () => null,
};
