import type {
  LinkResolver,
  LinkResolverStore,
  LinkTarget,
  PickerTarget,
} from "@repo/editor/host-io";
import { buildResolver } from "@repo/notes/knowledge/link-resolve";
import { createStore } from "zustand/vanilla";

// What a host installs as `EditorHostIo.linkResolver`, and the one input it feeds: the items a
// link can name. The library's resolver files each under a name of its own, so a link written
// with a title reaches the item that title names today, as the knowledge index resolves it, and
// one carrying an id reaches that item whatever it is called.
export interface LinkResolverFeed {
  readonly store: LinkResolverStore;
  readonly setTargets: (targets: readonly LinkTarget[]) => void;
}

const NO_RESOLVER: LinkResolver = {
  resolveWikiTarget: () => null,
  targets: [],
  titleOf: () => null,
};

// the name the resolver files an item under: its title, as a link writes it, with no folder in it
const filedName = (title: string): string => `${title.replaceAll("/", " ")}.md`;

export const createLinkResolverFeed = (): LinkResolverFeed => {
  const store = createStore<LinkResolver>()(() => NO_RESOLVER);
  return {
    setTargets: (next) => {
      const targets: PickerTarget[] = next.map((target) => ({
        ...target,
        path: filedName(target.title),
      }));
      // two items of one title file under one name, which reaches the first the host lists
      const owners = new Map<string, string>();
      for (const target of targets) {
        if (!owners.has(target.path)) {
          owners.set(target.path, target.id);
        }
      }
      const resolver = buildResolver(owners.keys());
      const titles = new Map(targets.map((target) => [target.id, target.title]));
      // rebuilt whole: the resolver's identity is what tells a link to re-render
      store.setState({
        // an id the link carries names its item whatever it is called now
        resolveWikiTarget: (target, alias) => {
          if (alias !== undefined && titles.has(alias)) {
            return alias;
          }
          const path = resolver.resolveWiki(target);
          return path === null ? null : (owners.get(path) ?? null);
        },
        targets,
        titleOf: (itemId) => titles.get(itemId) ?? null,
      });
    },
    store,
  };
};
