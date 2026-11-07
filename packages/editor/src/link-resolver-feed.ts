import type { LinkResolver, LinkResolverStore, LinkTarget } from "@repo/editor/host-io";
import { titleKey } from "@repo/notes/library/derive-item";
import { createStore } from "zustand/vanilla";

// What a host installs as `EditorHostIo.linkResolver`, and the one input it feeds: the items a
// link can name. A link written with a title reaches the item that title names today, by the key
// the cell resolves a title by, and one carrying an id reaches that item whatever it is called.
export interface LinkResolverFeed {
  readonly store: LinkResolverStore;
  readonly setTargets: (targets: readonly LinkTarget[]) => void;
}

const NO_RESOLVER: LinkResolver = {
  resolveWikiTarget: () => null,
  targets: [],
  titleOf: () => null,
};

export const createLinkResolverFeed = (): LinkResolverFeed => {
  const store = createStore<LinkResolver>()(() => NO_RESOLVER);
  return {
    setTargets: (targets) => {
      // two items of one title answer to one key, which reaches the first the host lists
      const owners = new Map<string, string>();
      for (const target of targets) {
        const key = titleKey(target.title);
        if (key !== "" && !owners.has(key)) {
          owners.set(key, target.id);
        }
      }
      const titles = new Map(targets.map((target) => [target.id, target.title]));
      // rebuilt whole: the resolver's identity is what tells a link to re-render
      store.setState({
        // an id the link carries names its item whatever it is called now
        resolveWikiTarget: (target, alias) =>
          alias !== undefined && titles.has(alias) ? alias : (owners.get(titleKey(target)) ?? null),
        targets,
        titleOf: (itemId) => titles.get(itemId) ?? null,
      });
    },
    store,
  };
};
