import type { LinkResolver, LinkResolverStore, VaultEntry } from "@repo/editor/host-io";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { resolverEntriesOf } from "@repo/notes/knowledge/wiki-target";
import type { WikiTarget } from "@repo/notes/knowledge/wiki-target";
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
  titleOf: () => null,
};

export const createLinkResolverFeed = (): LinkResolverFeed => {
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
    // an item's name is its file's, as its card shows it, never the first heading the picker shows
    const titles = new Map(
      targets.flatMap((target) =>
        target.id === undefined ? [] : [[target.id, docStem(target.path)]],
      ),
    );
    store.setState({
      resolveMdTarget: (target, fromPath) => resolver.resolveMd(target, fromPath),
      resolveWikiTarget: (target, alias) => resolver.resolveWiki(target, alias),
      targets,
      titleOf: (itemId) => titles.get(itemId) ?? null,
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
