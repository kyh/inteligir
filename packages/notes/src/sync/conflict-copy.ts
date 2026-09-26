// What a conflict copy is called and what every surface says about it. The desktop's sync, the
// phone's write queue and whoever pulls a copy another device made all read one spelling, so a
// name one writes is a name the other parses back to the same note and the same device.

import { docStem, freePath } from "../knowledge/doc-file";
import { basenamePath, dirnamePath, extnamePath, joinPath } from "../knowledge/vault-path";

const MAX_DEVICE_LABEL_LENGTH = 40;

// the committer older engine commits carry, which names no device
const LEGACY_ENGINE_COMMITTER = "inteligir";

const UNKNOWN_DEVICE = "another device";

// the label lands in a file name and in any [[link]] to it: what a path or the OS refuses goes,
// and so does what would end or redirect a wiki link
const UNSAFE_LABEL_RE = /[/\\:*?"<>|[\]#^\p{Cc}]/gu;
const WHITESPACE_RE = /\s+/gu;

export const deviceLabel = (raw: string): string => {
  const cleaned = raw
    .normalize("NFC")
    .replace(WHITESPACE_RE, " ")
    .replace(UNSAFE_LABEL_RE, "")
    .replace(WHITESPACE_RE, " ")
    .trim();
  const label = [...cleaned].slice(0, MAX_DEVICE_LABEL_LENGTH).join("").trimEnd();
  return label === "" || label === LEGACY_ENGINE_COMMITTER ? UNKNOWN_DEVICE : label;
};

const COPY_MARKER = " (conflict, ";

// The extension stays, so the copy opens as what it is; ` 2`, ` 3`… step past a taken name.
// `isTaken` is asked each candidate as spelled and should answer ignoring case
// (`takenIgnoringCase`), since the disk may.
export const conflictCopyPath = (
  path: string,
  device: string,
  isTaken: (path: string) => boolean,
): string => {
  const name = basenamePath(path);
  const extension = extnamePath(name);
  const stem = `${name.slice(0, name.length - extension.length)}${COPY_MARKER}${deviceLabel(device)})`;
  return freePath(dirnamePath(path), stem, extension, isTaken);
};

export interface ConflictCopyName {
  // the note the copy was made beside
  readonly path: string;
  // the label of the device whose version the copy holds
  readonly device: string;
}

// the tail after the marker: the label, its closing paren, a step of 2 or more, the extension
const COPY_TAIL_RE = /^(?<device>.+)\)(?: (?:[2-9]|[1-9]\d+))?(?<extension>\.[^.]*)?$/u;

// Only a name `conflictCopyPath` could have written parses: a label that is not already a label
// (`a:b`, `inteligir`, empty) is a near-miss, not a copy.
export const parseConflictCopyPath = (copyPath: string): ConflictCopyName | null => {
  const name = basenamePath(copyPath);
  const marker = name.lastIndexOf(COPY_MARKER);
  if (marker <= 0) {
    return null;
  }
  const stem = name.slice(0, marker);
  const tail = COPY_TAIL_RE.exec(name.slice(marker + COPY_MARKER.length))?.groups;
  const device = tail?.device;
  const extension = tail?.extension ?? "";
  if (device === undefined || deviceLabel(device) !== device) {
    return null;
  }
  const original = `${stem}${extension}`;
  if (extnamePath(original) !== extension) {
    return null;
  }
  return { device, path: joinPath(dirnamePath(copyPath), original) };
};

export type SyncConflictReport =
  | {
      readonly kind: "copied";
      readonly path: string;
      readonly copyPath: string;
      // whose version stayed at `path`
      readonly keptDevice: string;
      // whose version the copy holds
      readonly copyDevice: string;
    }
  | {
      readonly kind: "kept-edit";
      readonly path: string;
      readonly keptDevice: string;
      readonly deletedDevice: string;
    };

const quoted = (path: string): string => `“${docStem(path)}”`;

// The one sentence the desktop's notice, `inteligir vault status` and the phone all show, told
// from the reader's device: "yours" and "here" when it is one of the two, both names when not.
export const describeSyncConflict = (
  report: SyncConflictReport,
  { thisDevice }: { thisDevice: string },
): string => {
  const here = deviceLabel(thisDevice);
  const note = quoted(report.path);
  const kept = deviceLabel(report.keptDevice);
  // two devices may share a name; the kept side is asked first, since a copy made here always
  // kept this device's version
  const keptHere = kept === here;
  if (report.kind === "copied") {
    const copy = deviceLabel(report.copyDevice);
    const stays = keptHere ? "yours stays" : `the one from ${kept} stays`;
    const moved = !keptHere && copy === here ? "yours is" : `the one from ${copy} is`;
    return `Both versions of ${note} were kept: ${stays}, and ${moved} in ${quoted(report.copyPath)}.`;
  }
  const deleted = deviceLabel(report.deletedDevice);
  const deletedOn = !keptHere && deleted === here ? "here" : `on ${deleted}`;
  const editedOn = keptHere ? "here" : `on ${kept}`;
  return `${note} was deleted ${deletedOn} but edited ${editedOn}, so it was kept.`;
};
