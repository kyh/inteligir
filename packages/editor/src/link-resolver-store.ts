import type { LinkResolver, LinkResolverStore, VaultEntry } from "@repo/editor/host-io";
import { resolverEntriesOf } from "@repo/notes/knowledge/link-graph-index";
import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import { createStore } from "zustand/vanilla";

// What a host installs as `EditorHostIo.linkResolver`, and the two inputs it feeds: the session's
// listing and the index's wiki targets, which arrive apart.
export interface LinkResolverFeed {
  readonly store: LinkResolverStore;
  readonly setListing: (entries: readonly VaultEntry[]) => void;
  readonly setTargets: (targets: readonly WikiTarget[]) => void;
}

const NO_RESOLVER: LinkResolver = {
  resolveMdTarget: () => null,
  resolveWikiTarget: () => null,
  targets: [],
};

export const createLinkResolverStore = (): LinkResolverFeed => {
  let entries: readonly VaultEntry[] = [];
  let targets: readonly WikiTarget[] = [];
  const store = createStore<LinkResolver>()(() => NO_RESOLVER);
  // Rebuilt whole from either input: the resolver's identity is what tells a link to re-render.
  const rebuild = (): void => {
    const { aliasEntries, idEntries } = resolverEntriesOf(targets);
    const resolver = buildResolver(
      entries.map((entry) => entry.path),
      aliasEntries,
      idEntries,
    );
    store.setState({
      resolveMdTarget: (target, fromPath) => resolver.resolveMd(target, fromPath),
      resolveWikiTarget: (target, alias) => resolver.resolveWiki(target, alias),
      targets,
    });
  };
  return {
    setListing: (next) => {
      entries = next;
      rebuild();
    },
    setTargets: (next) => {
      targets = next;
      rebuild();
    },
    store,
  };
};
