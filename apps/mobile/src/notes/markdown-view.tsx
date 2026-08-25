import { Linking, StyleSheet, Text, View } from "react-native";
import { RADIUS, SPACE, useTheme, type Theme } from "@/lib/theme";
import type { InlineSpan, NoteBlock } from "./note-projection";

// The thin half of the note renderer: projected blocks in, RN elements out.
// Every decision about WHAT to show lives in note-projection.ts; what this
// file owns is spacing, type scale and the tap targets.

const HEADING_SIZES = {
  1: 26,
  2: 22,
  3: 19,
  4: 17,
  5: 16,
  6: 15,
} satisfies Record<1 | 2 | 3 | 4 | 5 | 6, number>;

function spanKey(index: number): string {
  return `s${String(index)}`;
}

function Spans({
  spans,
  theme,
  onWikiLink,
}: {
  spans: readonly InlineSpan[];
  theme: Theme;
  onWikiLink: (target: string) => void;
}) {
  return (
    <>
      {spans.map((span, index) => {
        switch (span.kind) {
          case "text":
            return (
              <Text
                key={spanKey(index)}
                style={[
                  span.bold === true && styles.bold,
                  span.italic === true && styles.italic,
                  span.strike === true && styles.strike,
                  span.code === true && [styles.mono, { backgroundColor: theme.muted }],
                ]}
              >
                {span.text}
              </Text>
            );
          case "wiki-link":
            return (
              <Text
                key={spanKey(index)}
                style={{ color: theme.primary }}
                onPress={() => onWikiLink(span.target)}
              >
                {span.label}
              </Text>
            );
          case "formula":
            return (
              <Text
                key={spanKey(index)}
                style={[styles.mono, { backgroundColor: theme.muted, color: theme.foreground }]}
              >
                {span.label}
              </Text>
            );
          case "link":
            return (
              <Text
                key={spanKey(index)}
                style={{ color: theme.primary }}
                onPress={() => void Linking.openURL(span.url).catch(() => undefined)}
              >
                {span.label}
              </Text>
            );
        }
      })}
    </>
  );
}

function blockKey(index: number): string {
  return `b${String(index)}`;
}

export function MarkdownBlocks({
  blocks,
  onWikiLink,
}: {
  blocks: readonly NoteBlock[];
  onWikiLink: (target: string) => void;
}) {
  const theme = useTheme();
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading":
            return (
              <Text
                key={blockKey(index)}
                style={[
                  styles.heading,
                  { color: theme.foreground, fontSize: HEADING_SIZES[block.depth] },
                ]}
              >
                <Spans spans={block.spans} theme={theme} onWikiLink={onWikiLink} />
              </Text>
            );
          case "paragraph":
            return (
              <Text key={blockKey(index)} style={[styles.paragraph, { color: theme.foreground }]}>
                <Spans spans={block.spans} theme={theme} onWikiLink={onWikiLink} />
              </Text>
            );
          case "list-item":
            return (
              <View
                key={blockKey(index)}
                style={[styles.listRow, { paddingLeft: SPACE.lg * (block.depth + 1) }]}
              >
                <Text style={[styles.listMarker, { color: theme.mutedForeground }]}>
                  {block.checked === null
                    ? block.ordinal === null
                      ? "•"
                      : `${String(block.ordinal)}.`
                    : block.checked
                      ? "☑"
                      : "☐"}
                </Text>
                <Text style={[styles.listBody, { color: theme.foreground }]}>
                  <Spans spans={block.spans} theme={theme} onWikiLink={onWikiLink} />
                </Text>
              </View>
            );
          case "code":
            return (
              <View
                key={blockKey(index)}
                style={[styles.codeBlock, { backgroundColor: theme.muted }]}
              >
                <Text style={[styles.mono, styles.codeText, { color: theme.foreground }]}>
                  {block.text}
                </Text>
              </View>
            );
          case "callout":
            return (
              <View
                key={blockKey(index)}
                style={[styles.callout, { borderColor: theme.border, backgroundColor: theme.card }]}
              >
                <Text style={[styles.calloutLabel, { color: theme.mutedForeground }]}>
                  {block.label.toUpperCase()}
                </Text>
                <MarkdownBlocks blocks={block.blocks} onWikiLink={onWikiLink} />
              </View>
            );
          case "quote":
            return (
              <View key={blockKey(index)} style={[styles.quote, { borderLeftColor: theme.border }]}>
                <MarkdownBlocks blocks={block.blocks} onWikiLink={onWikiLink} />
              </View>
            );
          case "divider":
            return (
              <View
                key={blockKey(index)}
                style={[styles.divider, { backgroundColor: theme.border }]}
              />
            );
          case "unsupported":
            return (
              <View
                key={blockKey(index)}
                style={[styles.unsupported, { borderColor: theme.border }]}
              >
                <Text style={[styles.calloutLabel, { color: theme.mutedForeground }]}>
                  {block.label} — open on your desktop
                </Text>
              </View>
            );
          case "raw":
            return (
              <View
                key={blockKey(index)}
                style={[styles.codeBlock, { backgroundColor: theme.muted }]}
              >
                <Text style={[styles.mono, styles.codeText, { color: theme.mutedForeground }]}>
                  {block.text}
                </Text>
              </View>
            );
        }
      })}
    </>
  );
}

const styles = StyleSheet.create({
  heading: { fontWeight: "700", marginTop: SPACE.lg, marginBottom: SPACE.sm },
  paragraph: { fontSize: 16, lineHeight: 24, marginBottom: SPACE.md },
  listRow: { flexDirection: "row", gap: SPACE.sm, marginBottom: SPACE.xs },
  listMarker: { fontSize: 16, lineHeight: 24 },
  listBody: { flex: 1, fontSize: 16, lineHeight: 24 },
  codeBlock: {
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    marginBottom: SPACE.md,
  },
  codeText: { fontSize: 13, lineHeight: 19 },
  callout: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.md,
    marginBottom: SPACE.md,
    gap: SPACE.xs,
  },
  calloutLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginBottom: SPACE.sm },
  quote: { borderLeftWidth: 3, paddingLeft: SPACE.md, marginBottom: SPACE.md },
  divider: { height: 1, marginVertical: SPACE.lg },
  unsupported: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
    marginBottom: SPACE.md,
  },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  strike: { textDecorationLine: "line-through" },
  mono: { fontFamily: "Menlo", fontSize: 14 },
});
