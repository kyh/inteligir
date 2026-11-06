// What a `[[…]]` picker lists and a link resolves against: an item by its path, its title, its
// aliases and its id, as each host's editor feeds them from its own library.

export interface WikiTarget {
  path: string;
  title: string;
  type: "doc" | "asset";
  aliases?: string[];
  pinned?: boolean;
  id?: string;
}

// the alias and id tiers `buildResolver` takes, read off the targets a host feeds
export const resolverEntriesOf = (targets: readonly WikiTarget[]) => {
  const aliasEntries: (readonly [string, string])[] = [];
  const idEntries: (readonly [string, string])[] = [];
  for (const target of targets) {
    for (const alias of target.aliases ?? []) {
      aliasEntries.push([alias, target.path]);
    }
    if (target.id !== undefined) {
      idEntries.push([target.id, target.path]);
    }
  }
  return { aliasEntries, idEntries };
};
