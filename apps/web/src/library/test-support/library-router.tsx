// The library's routes over memory, for a screen's suite: the routes' own pieces under a bare root,
// opened by what the suite hands in place of the tab's open, so a screen runs under the router, the
// QueryClient and the library it runs under in the tab.

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import type { PageLibrary } from "../cloud/library-context";
import { createPageQueryClient } from "../cloud/v1";
import { LibraryLayout, seedScopes } from "../library-layout";
import { librarySearchSchema } from "../library-search";
import type { FloorRefusal, TabOpening } from "../library-tab";
import { RenderCrash } from "../render-crash";
import { seedSettings, SettingsRoute } from "../settings/settings-route";

export const createLibraryRouter = (entry: string, open: () => Promise<TabOpening>) => {
  const root = createRootRoute();
  const library = createRoute({
    beforeLoad: async () => ({ opening: await open() }),
    component: LibraryLayout,
    errorComponent: RenderCrash,
    getParentRoute: () => root,
    loader: seedScopes,
    path: "library",
    validateSearch: librarySearchSchema,
  });
  const index = createRoute({ getParentRoute: () => library, path: "/" });
  const settings = createRoute({
    component: SettingsRoute,
    errorComponent: RenderCrash,
    getParentRoute: () => library,
    loader: seedSettings,
    path: "settings",
  });
  return createRouter({
    defaultPreloadStaleTime: 0,
    history: createMemoryHistory({ initialEntries: [entry] }),
    routeTree: root.addChildren([library.addChildren([index, settings])]),
  });
};

const neverRefused: FloorRefusal = {
  refused: () => false,
  subscribe: () => () => {},
};

// a tab opened over a suite's library
export const openedOver = (library: PageLibrary) => async (): Promise<TabOpening> => {
  await Promise.resolve();
  return { floor: neverRefused, kind: "open", library, queryClient: createPageQueryClient() };
};
