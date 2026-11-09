// The text a library's filing rules start from the first time the person edits them: prose they
// change, which every conversation with the built-in agent follows over its own taste. Unsorted is
// where an item with no folder shows, never a folder of its own, so the rules say its items are
// the ones to file, and that only an item already in a folder stays where it is.

export const FILING_RULES_TEXT = `# Filing rules

How the agent files and tags what you save, when you ask it to tidy your library or to file something. Change anything here: it follows these rules every time.

- Unsorted is not a folder: its items are the ones to file.
- Things to read later go in **Reading**.
- Recipes go in **Cooking**.
- Make a new folder only when five or more items belong in it. Otherwise leave them in Unsorted and say so.
- Give each item one to three topic tags, reusing the tags the library already has. Never tag by kind, and write tags without #.
- Never move an item already filed in a folder, never delete anything, and never change an item's text.
`;
