// The `[[` autocomplete's trigger-element key, alone in a dependency-free
// module: markdown-kit (composed into BASE_KIT) needs it for disallowedNodes,
// while the kit itself (wiki-autocomplete.tsx) reaches into vault-context —
// importing the key from there would close an import cycle around the kits.

export const WIKI_INPUT_KEY = "wiki_input";
