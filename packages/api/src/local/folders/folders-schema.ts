// not a permission grant: the agent's shell already reads anything the os lets this user
// read, so these rows widen nothing and no copy may describe them as granting access.
// "read-only" is intent carried in the instructions line, enforced by no layer here.

import { z } from "zod";

export const CONNECTED_FOLDERS_MAX = 32;

// absoluteness is judged server-side against its own platform's rules
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
