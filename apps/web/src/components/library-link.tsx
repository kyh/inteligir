import { LIBRARY_PAGE_PATH } from "@repo/contract/library-page";

// a plain anchor, since the site's router holds no such page; the page sends a signed-out tab to
// sign in and back, so one link serves someone signed in and someone not
export const LibraryLink = ({ className }: { className: string }) => (
  <a href={LIBRARY_PAGE_PATH} className={className}>
    Open your library
  </a>
);
