// Where the WebView finds the editor page: in the app bundle, so a note opens offline and nothing
// is fetched. The page has no dev server (its CSP refuses the script a Vite dev page injects), so a
// development build carries the built page too. Only a screen imports this; it loads native
// modules.

import { Directory, File, Paths } from "expo-file-system";
import { EDITOR_PAGE_FOLDER } from "./page-folder";

export interface PageSource {
  readonly uri: string;
  // what the page may read beside itself: its own folder, never the rest of the bundle
  readonly readAccess: string;
}

// null for a build made without the page, which has no editor to open
export const editorPageSource = (): PageSource | null => {
  const folder = new Directory(Paths.bundle, EDITOR_PAGE_FOLDER);
  const page = new File(folder, "index.html");
  return page.exists ? { readAccess: folder.uri, uri: page.uri } : null;
};
