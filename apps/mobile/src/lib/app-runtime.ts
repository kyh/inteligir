import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import { addNetworkStateListener } from "expo-network";
import * as SecureStore from "expo-secure-store";
import { createKeychainCredentials } from "../credential/secure-store-credential";
import { createEditorPorts } from "../editor/editor-ports";
import type { EditorPorts, EditorPortsArgs } from "../editor/editor-ports";
import { editorPageSource } from "../editor/page-source";
import type { PageSource } from "../editor/page-source";
import { shrinkCover } from "../items/expo-cover-shrink";
import { createFillPageHost } from "../items/fill-page-host";
import type { FillPageHost } from "../items/fill-page-host";
import type { SavedItem } from "../items/item-ops";
import { createPageFetch } from "../items/page-fetch";
import { createCoverThumbs } from "../library/cover-thumbs";
import type { CoverThumbs } from "../library/cover-thumbs";
import { createExpoCoverThumbPort } from "../library/expo-cover-thumbs";
import { cardMatches, libraryCardAt, libraryCards, libraryScopes } from "../library/library-view";
import type { LibraryCard, LibraryFilter, LibraryScopes } from "../library/library-view";
import { defaultDeviceName } from "../login/device-name";
import type { LoginRequest, LoginState } from "../login/login-store";

import { createExpoAttachmentFiles } from "../notes/expo-attachment-files";
import { createExpoOutboxFolder } from "../notes/expo-outbox-files";
import type { CreatedNote, RenamedNote } from "../notes/file-ops";
import type { AnnotationsRead, NoteRead, NoteText, NotesTreeState } from "../notes/notes-store";
import { excludedFromBackup } from "../notes/outbox-files";
import { ingestPhoto } from "../notes/photo-ingest";
import type { OutboxStatus } from "../notes/vault-outbox";
import { rnSocketDial } from "../sync/rn-socket-dial";
import type { SyncStatus } from "../sync/sync-runtime";
import { hexFromBytes } from "@repo/contract/cloud/bytes";
import { createCloudSocketOpener } from "@repo/contract/cloud/sync/cloud-socket";
import { excludeFromBackup } from "./backup-exclusion";
import { getCloudUrl } from "./cloud-url";
import { composeRuntime } from "./compose-runtime";
import type { AppRuntime, LogoutOutcome } from "./compose-runtime";
import { createExpoSqlDriver } from "./expo-sql-driver";
import { openPhoneDb } from "./phone-db";

let runtime: AppRuntime | null = null;
let thumbs: CoverThumbs | null = null;
let reader: { host: FillPageHost; source: PageSource } | null | undefined;

// console.warn would raise a LogBox toast per offline check.
const devLog = (message: string): void => {
  if (__DEV__) {
    console.log(`sync: ${message}`);
  }
};

// the version app.config.js read from the package. a build that carries none says 0.0.0, which
// the cloud refuses as too old rather than letting a build it cannot place through
const appVersion = (): string => Constants.expoConfig?.version ?? "0.0.0";

const attachments = createExpoAttachmentFiles();

// one per load of the editor page, and of the reader
export const mintBridgeNonce = (): string => hexFromBytes(Crypto.getRandomBytes(16));

// the page in its reader mode, which ReaderPage mounts; null for a build made without the page
export const readerPage = (): { host: FillPageHost; source: PageSource } | null => {
  if (reader === undefined) {
    const source = editorPageSource();
    reader =
      source === null
        ? null
        : { host: createFillPageHost({ mintNonce: mintBridgeNonce, pageUrl: source.uri }), source };
  }
  return reader;
};

// a saved page is asked for as Safari on the phone would ask, naming the app after it
const userAgent = (): string =>
  `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 inteligir/${appVersion()}`;

// the phone's own language first, its bare language after
const acceptLanguage = (): string => {
  const { locale } = Intl.DateTimeFormat().resolvedOptions();
  const [language = "en"] = locale.split("-");
  return locale === language ? locale : `${locale},${language};q=0.9`;
};

const build = (): AppRuntime => {
  let online = true;
  const rt = composeRuntime({
    attachments,
    build: { platform: "mobile", version: appVersion() },
    cloudUrl: getCloudUrl(),
    credentials: createKeychainCredentials(SecureStore),
    db: openPhoneDb(createExpoSqlDriver("inteligir.db")),
    deviceName: defaultDeviceName(),
    fill: {
      fetch: createPageFetch(globalThis.fetch, {
        acceptLanguage: acceptLanguage(),
        userAgent: userAgent(),
      }),
      online: () => online,
      read: async (job) => {
        const page = readerPage();
        if (page === null) {
          throw new Error("This build has no page to read links with.");
        }
        return await page.host.read(job);
      },
      sha256Hex: async (bytes) =>
        hexFromBytes(
          new Uint8Array(
            await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes)),
          ),
        ),
      shrinkCover,
    },
    newId: Crypto.randomUUID,
    outboxFiles: excludedFromBackup(createExpoOutboxFolder(), excludeFromBackup),
    randomBytes: Crypto.getRandomBytes,
    sha1: async (bytes) =>
      new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA1, bytes)),
    sync: { onDebug: devLog, openSocket: createCloudSocketOpener(rnSocketDial) },
  });
  // never removed: the runtime lives as long as the app, and a resume while signed out is a no-op.
  // `inactive` is a passing state on iOS (a pulled-down notification centre), not a departure.
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      rt.resume();
    } else if (state === "background") {
      rt.suspend();
    }
  });
  // a phone back online sends what it saved offline, and reads what it saved, without waiting for
  // the retry timer; in the background it waits for the foreground, which reopens the socket too
  addNetworkStateListener((network) => {
    const reachable = network.isInternetReachable ?? network.isConnected ?? false;
    if (reachable && !online && AppState.currentState === "active") {
      rt.resume();
    }
    online = reachable;
  });
  return rt;
};

const getRuntime = (): AppRuntime => {
  runtime ??= build();
  return runtime;
};

export const ensureStarted = async (): Promise<void> => {
  await getRuntime().start();
};

export const logout = async (options?: { discardUnsent?: boolean }): Promise<LogoutOutcome> =>
  await getRuntime().logout(options);

export const login = async (request: LoginRequest): Promise<void> => {
  await getRuntime().login.login(request);
};

export const refreshNotes = async (): Promise<void> => {
  await getRuntime().notes.refresh();
};

export const readNote = async (path: string): Promise<NoteRead> =>
  await getRuntime().notes.readNote(path);

export const readNoteAnnotations = async (note: NoteText): Promise<AnnotationsRead> =>
  await getRuntime().notes.readAnnotations(note);

export const createNote = async (dir: string): Promise<CreatedNote> =>
  await getRuntime().fileOps.create(dir);

export const renameNote = async (from: string, name: string): Promise<RenamedNote> =>
  await getRuntime().fileOps.rename(from, name);

export const deleteNote = async (path: string): Promise<void> => {
  await getRuntime().fileOps.remove(path);
};

// the files a delete of `path` would take with it, which the confirm counts
export const filesFreedBy = async (path: string): Promise<readonly string[]> =>
  await getRuntime().fileOps.freedBy(path);

export const saveLink = async (link: {
  url: string;
  title: string | null;
  note: string | null;
}): Promise<SavedItem> => await getRuntime().items.saveLink(link);

export const saveText = async (text: string): Promise<SavedItem> =>
  await getRuntime().items.saveText(text);

export interface LibraryView {
  tree: NotesTreeState;
  cards: readonly LibraryCard[];
  scopes: LibraryScopes;
}

// the Library over what the phone holds, listed again whenever the listing moves
export const useLibrary = (filter: LibraryFilter): LibraryView => {
  const rt = getRuntime();
  const tree = useSyncExternalStore(rt.notes.tree.subscribe, rt.notes.tree.get);
  const { kinds, query, scope } = filter;
  // the tree moves with every listing the store publishes, and heldFiles is that listing
  const files = useMemo(() => (tree.state === "ready" ? rt.notes.heldFiles() : []), [rt, tree]);
  const cards = useMemo(
    () => libraryCards(files, { kinds, query, scope }),
    [files, kinds, query, scope],
  );
  const scopes = useMemo(() => libraryScopes(files), [files]);
  return { cards, scopes, tree };
};

// whether the Library under `filter` lists `path` now: a save the screen shows says nothing more
export const listsNow = (filter: LibraryFilter, path: string): boolean => {
  const card = libraryCardAt(getRuntime().notes.heldFiles(), path);
  return card !== null && cardMatches(card, filter);
};

// one item's card, kept current with the listing
export const useLibraryCard = (path: string | null): LibraryCard | null => {
  const rt = getRuntime();
  const tree = useSyncExternalStore(rt.notes.tree.subscribe, rt.notes.tree.get);
  return useMemo(
    () =>
      path === null || tree.state !== "ready" ? null : libraryCardAt(rt.notes.heldFiles(), path),
    [rt, tree, path],
  );
};

const coverThumbs = (): CoverThumbs => {
  const rt = getRuntime();
  thumbs ??= createCoverThumbs(
    createExpoCoverThumbPort({
      attachments,
      original: async (path) => await rt.notes.attachmentFile(path),
    }),
  );
  return thumbs;
};

// the file:// a card draws its cover from; null until it is on this phone, or when it cannot be
export const useCoverThumb = (cover: string | null): string | null => {
  const [uri, setUri] = useState<{ cover: string; uri: string | null } | null>(null);
  useEffect(() => {
    if (cover === null) {
      return;
    }
    let live = true;
    void (async () => {
      const made = await coverThumbs().thumbFor(cover);
      if (live) {
        setUri({ cover, uri: made });
      }
    })();
    return () => {
      live = false;
    };
  }, [cover]);
  return uri !== null && uri.cover === cover ? uri.uri : null;
};

// a held file's bytes on this phone, downloaded on the first ask: a viewer's image or PDF
export const attachmentFile = async (
  path: string,
): Promise<{ ok: true; uri: string } | { ok: false; message: string }> =>
  await getRuntime().notes.attachmentFile(path);

// the editor page's ports over the store and the file verbs, bound to their native halves: the
// photo picker and a held file's bytes
export const createNoteEditorPorts = (
  screen: Pick<
    EditorPortsArgs,
    "editorState" | "go" | "notify" | "openFailed" | "opened" | "showAnnotations"
  >,
): EditorPorts => {
  const rt = getRuntime();
  return createEditorPorts({
    ...screen,
    annotations: rt.annotations,
    fileOps: rt.fileOps,
    pickImage: async () => await ingestPhoto(rt.fileOps),
    readBase64: async (uri) => await new File(uri).base64(),
    store: rt.notes,
  });
};

// what has not reached the vault: the parked changes and the conflicts the queue settled
export const useOutboxStatus = (): OutboxStatus => {
  const { status } = getRuntime().notes.outbox;
  return useSyncExternalStore(status.subscribe, status.get);
};

export const retryUnsent = async (seq: number): Promise<void> => {
  await getRuntime().notes.outbox.retry(seq);
};

// the path the change was kept at, or null when it had nothing to keep
export const saveUnsentAsNew = async (seq: number): Promise<string | null> =>
  await getRuntime().notes.outbox.saveAsNew(seq);

export const discardUnsent = async (seq: number): Promise<void> => {
  await getRuntime().notes.outbox.discard(seq);
};

export const dismissSyncNotice = (id: number): void => {
  getRuntime().notes.outbox.dismiss(id);
};

export const useSyncStatus = (): SyncStatus => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.sync.subscribe, rt.sync.get);
};

export const useLoginState = (): LoginState => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.login.subscribe, rt.login.get);
};
