import { dirnamePath, parseVaultPath } from "@repo/notes/knowledge/vault-path";

import type { AttachmentLocation } from "./vault-schema";

// the folder a pasted image lands in, "" being the vault root. A note-relative choice with no
// note open has nothing to be beside, so it lands at the root rather than refusing the paste.
export const attachmentDir = (location: AttachmentLocation, notePath: string | null): string => {
  switch (location.kind) {
    case "root": {
      return "";
    }
    case "beside-note": {
      return notePath === null ? "" : dirnamePath(notePath);
    }
    case "folder": {
      return location.path;
    }
    // no default
  }
};

// the CLI's one spelling of a location, parsed and printed by the same pair
export const ATTACHMENT_LOCATION_SPELLINGS = "root | beside-note | folder:<path>";

const FOLDER_PREFIX = "folder:";

export const parseAttachmentLocation = (spelling: string): AttachmentLocation | null => {
  if (spelling === "root") {
    return { kind: "root" };
  }
  if (spelling === "beside-note") {
    return { kind: "beside-note" };
  }
  if (!spelling.startsWith(FOLDER_PREFIX)) {
    return null;
  }
  const parsed = parseVaultPath(spelling.slice(FOLDER_PREFIX.length));
  return parsed.ok ? { kind: "folder", path: parsed.path } : null;
};

export const formatAttachmentLocation = (location: AttachmentLocation): string => {
  switch (location.kind) {
    case "root": {
      return "root";
    }
    case "beside-note": {
      return "beside-note";
    }
    case "folder": {
      return `${FOLDER_PREFIX}${location.path}`;
    }
    // no default
  }
};

export const describeAttachmentLocation = (location: AttachmentLocation): string => {
  switch (location.kind) {
    case "root": {
      return "in the vault root";
    }
    case "beside-note": {
      return "beside the note";
    }
    case "folder": {
      return `under ${location.path}/`;
    }
    // no default
  }
};
