// The connected-folders wire contract: extra directories agent sessions are
// TOLD ABOUT as read-only reference context (Connected Folders).
//
// Deliberately not a permission grant: the agent's shell can already read
// anything the OS lets this user read — the vault containment decisions guard
// the VAULT API, not the harness's own filesystem access. So these rows widen
// nothing; they are an affordance (Settings and the CLI list the same rows)
// plus an instructions line, and no copy anywhere may describe them as
// granting access. "Read-only" is the user's stated intent for the folders,
// carried in the instructions, not something any layer here can enforce.

import { z } from "zod";

/** Bound on the list, not a security bound: an instructions line naming
 *  hundreds of folders is a prompt cost nobody meant to pay. */
export const CONNECTED_FOLDERS_MAX = 32;

/** The wire carries the path verbatim; the server resolves and validates —
 *  absoluteness is checked THERE against its own platform's rules, so the
 *  contract only refuses the obviously empty. */
export const connectedFolderPathSchema = z.string().min(1).max(1024);

export const connectedFoldersResponseSchema = z
  .object({ folders: z.array(connectedFolderPathSchema) })
  .strict();
export type ConnectedFoldersResponse = z.infer<typeof connectedFoldersResponseSchema>;

export const connectedFolderAddRequestSchema = z
  .object({ path: connectedFolderPathSchema })
  .strict();
export type ConnectedFolderAddRequest = z.infer<typeof connectedFolderAddRequestSchema>;

export const connectedFolderRemoveRequestSchema = z
  .object({ path: connectedFolderPathSchema })
  .strict();
export type ConnectedFolderRemoveRequest = z.infer<typeof connectedFolderRemoveRequestSchema>;
