// alone in a dependency-free module: markdown-kit needs it for disallowedNodes, and importing
// it from wiki-autocomplete would close an import cycle around the kits.

export const WIKI_INPUT_KEY = "wiki_input";
