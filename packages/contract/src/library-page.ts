// Where the Worker serves the library's page, the SPA `@repo/workspace` builds: its own prefix,
// beside the site's routes, which keep theirs. The page's router and its build name this base, and
// the Worker answers every path under it with the page's document from its assets.

export const LIBRARY_PAGE_PATH = "/library";
