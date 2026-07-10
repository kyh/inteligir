// ---------------------------------------------------------------------------
// react-native-markdown-display style maps, shared by the note viewer and the
// chat screen. Colors mirror src/styles.css zinc tokens for light + dark;
// StyleSheet keys match the library's node types.
// ---------------------------------------------------------------------------

import { StyleSheet } from "react-native";

const lightMarkdownStyles = StyleSheet.create({
  body: { color: "#171717", fontSize: 16, lineHeight: 24 },
  heading1: { color: "#171717", fontSize: 24, fontWeight: "700", marginTop: 12, marginBottom: 6 },
  heading2: { color: "#171717", fontSize: 20, fontWeight: "700", marginTop: 12, marginBottom: 6 },
  heading3: { color: "#171717", fontSize: 18, fontWeight: "600", marginTop: 10, marginBottom: 4 },
  link: { color: "#2563eb" },
  code_inline: {
    backgroundColor: "#f4f4f5",
    color: "#171717",
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  fence: { backgroundColor: "#f4f4f5", color: "#171717", borderRadius: 8, padding: 12 },
  code_block: { backgroundColor: "#f4f4f5", color: "#171717", borderRadius: 8, padding: 12 },
  blockquote: {
    backgroundColor: "#f4f4f5",
    borderColor: "#e5e5e5",
    borderLeftWidth: 4,
    paddingHorizontal: 12,
  },
  hr: { backgroundColor: "#e5e5e5" },
});

const darkMarkdownStyles = StyleSheet.create({
  body: { color: "#f5f5f5", fontSize: 16, lineHeight: 24 },
  heading1: { color: "#f5f5f5", fontSize: 24, fontWeight: "700", marginTop: 12, marginBottom: 6 },
  heading2: { color: "#f5f5f5", fontSize: 20, fontWeight: "700", marginTop: 12, marginBottom: 6 },
  heading3: { color: "#f5f5f5", fontSize: 18, fontWeight: "600", marginTop: 10, marginBottom: 4 },
  link: { color: "#6b97ff" },
  code_inline: {
    backgroundColor: "#1e1e1e",
    color: "#f5f5f5",
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  fence: { backgroundColor: "#1e1e1e", color: "#f5f5f5", borderRadius: 8, padding: 12 },
  code_block: { backgroundColor: "#1e1e1e", color: "#f5f5f5", borderRadius: 8, padding: 12 },
  blockquote: {
    backgroundColor: "#1e1e1e",
    borderColor: "#404040",
    borderLeftWidth: 4,
    paddingHorizontal: 12,
  },
  hr: { backgroundColor: "#404040" },
});

/** The markdown style map for the current color scheme. */
export function markdownStylesFor(dark: boolean): StyleSheet.NamedStyles<unknown> {
  return dark ? darkMarkdownStyles : lightMarkdownStyles;
}
