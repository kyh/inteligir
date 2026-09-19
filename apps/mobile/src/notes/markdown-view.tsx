import { useState } from "react";
import { Image, Linking, StyleSheet, Text, View } from "react-native";

import { MONO_FONT, RADIUS, SPACE, useTheme } from "@/lib/theme";
import type { Theme } from "@/lib/theme";
import type { InlineSpan, NoteBlock } from "./note-projection";
import type { VaultAssetSource } from "@repo/api/cloud/client";

// only http(s) leaves the app: a hosted note is another device's content, and file:/intent:/custom
// schemes would hand it app-launching power.
const openExternalLink = async (url: string): Promise<void> => {
  if (!/^https?:\/\//iu.test(url)) {
    return;
  }
  try {
    await Linking.openURL(url);
  } catch {
    // no handler for the URL is the OS's answer, not an app error
  }
};

const styles = StyleSheet.create({
  bold: { fontWeight: "700" },
  callout: {
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: SPACE.xs,
    marginBottom: SPACE.md,
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.md,
  },
  calloutLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, marginBottom: SPACE.sm },
  codeBlock: {
    borderRadius: RADIUS.md,
    marginBottom: SPACE.md,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
  },
  codeText: { fontSize: 13, lineHeight: 19 },
  divider: { height: 1, marginVertical: SPACE.lg },
  embedImage: { borderRadius: RADIUS.md, height: 240, marginBottom: SPACE.md, width: "100%" },
  heading: { fontWeight: "700", marginBottom: SPACE.sm, marginTop: SPACE.lg },
  italic: { fontStyle: "italic" },
  listBody: { flex: 1, fontSize: 16, lineHeight: 24 },
  listMarker: { fontSize: 16, lineHeight: 24 },
  listRow: { flexDirection: "row", gap: SPACE.sm, marginBottom: SPACE.xs },
  mono: { fontFamily: MONO_FONT, fontSize: 14 },
  paragraph: { fontSize: 16, lineHeight: 24, marginBottom: SPACE.md },
  quote: { borderLeftWidth: 3, marginBottom: SPACE.md, paddingLeft: SPACE.md },
  strike: { textDecorationLine: "line-through" },
  unsupported: {
    borderRadius: RADIUS.md,
    borderStyle: "dashed",
    borderWidth: 1,
    marginBottom: SPACE.md,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.md,
  },
});

const HEADING_SIZES = {
  1: 26,
  2: 22,
  3: 19,
  4: 17,
  5: 16,
  6: 15,
} satisfies Record<1 | 2 | 3 | 4 | 5 | 6, number>;

const spanKey = (index: number): string => `s${String(index)}`;

const Spans = ({
  spans,
  theme,
  onWikiLink,
}: {
  spans: readonly InlineSpan[];
  theme: Theme;
  onWikiLink: (target: string) => void;
}) => (
  <>
    {spans.map((span, index) => {
      switch (span.kind) {
        case "text": {
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
        }
        case "wiki-link":
        case "image-embed": {
          return (
            <Text
              key={spanKey(index)}
              style={{ color: theme.primary }}
              onPress={() => {
                onWikiLink(span.target);
              }}
            >
              {span.label}
            </Text>
          );
        }
        case "formula": {
          return (
            <Text
              key={spanKey(index)}
              style={[styles.mono, { backgroundColor: theme.muted, color: theme.foreground }]}
            >
              {span.label}
            </Text>
          );
        }
        case "link": {
          return (
            <Text
              key={spanKey(index)}
              style={{ color: theme.primary }}
              onPress={() => {
                void openExternalLink(span.url);
              }}
            >
              {span.label}
            </Text>
          );
        }
        default: {
          return null;
        }
      }
    })}
  </>
);

const blockKey = (index: number): string => `b${String(index)}`;

const listMarker = (checked: boolean | null, ordinal: number | null): string => {
  if (checked !== null) {
    return checked ? "☑" : "☐";
  }
  return ordinal === null ? "•" : `${String(ordinal)}.`;
};

const unavailable = (label: string): string => `${label} — image unavailable`;

const Notice = ({ text, theme }: { text: string; theme: Theme }) => (
  <View style={[styles.unsupported, { borderColor: theme.border }]}>
    <Text style={[styles.calloutLabel, { color: theme.mutedForeground }]}>{text}</Text>
  </View>
);

const EmbedImage = ({
  source,
  label,
  theme,
}: {
  source: VaultAssetSource;
  label: string;
  theme: Theme;
}) => {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <Notice text={unavailable(label)} theme={theme} />;
  }
  return (
    <Image
      source={{ headers: source.headers, uri: source.uri }}
      style={[styles.embedImage, { backgroundColor: theme.muted }]}
      resizeMode="contain"
      accessibilityLabel={label}
      onError={() => {
        setFailed(true);
      }}
    />
  );
};

export const MarkdownBlocks = ({
  blocks,
  onWikiLink,
  resolveAsset,
}: {
  blocks: readonly NoteBlock[];
  onWikiLink: (target: string) => void;
  resolveAsset: (target: string) => VaultAssetSource | null;
}) => {
  const theme = useTheme();
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "heading": {
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
          }
          case "paragraph": {
            return (
              <Text key={blockKey(index)} style={[styles.paragraph, { color: theme.foreground }]}>
                <Spans spans={block.spans} theme={theme} onWikiLink={onWikiLink} />
              </Text>
            );
          }
          case "image": {
            const source = resolveAsset(block.target);
            if (source === null) {
              return <Notice key={blockKey(index)} text={unavailable(block.label)} theme={theme} />;
            }
            return (
              <EmbedImage key={blockKey(index)} source={source} label={block.label} theme={theme} />
            );
          }
          case "list-item": {
            return (
              <View
                key={blockKey(index)}
                style={[styles.listRow, { paddingLeft: SPACE.lg * (block.depth + 1) }]}
              >
                <Text style={[styles.listMarker, { color: theme.mutedForeground }]}>
                  {listMarker(block.checked, block.ordinal)}
                </Text>
                <Text style={[styles.listBody, { color: theme.foreground }]}>
                  <Spans spans={block.spans} theme={theme} onWikiLink={onWikiLink} />
                </Text>
              </View>
            );
          }
          case "code": {
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
          }
          case "callout": {
            return (
              <View
                key={blockKey(index)}
                style={[styles.callout, { backgroundColor: theme.card, borderColor: theme.border }]}
              >
                <Text style={[styles.calloutLabel, { color: theme.mutedForeground }]}>
                  {block.label.toUpperCase()}
                </Text>
                <MarkdownBlocks
                  blocks={block.blocks}
                  onWikiLink={onWikiLink}
                  resolveAsset={resolveAsset}
                />
              </View>
            );
          }
          case "quote": {
            return (
              <View key={blockKey(index)} style={[styles.quote, { borderLeftColor: theme.border }]}>
                <MarkdownBlocks
                  blocks={block.blocks}
                  onWikiLink={onWikiLink}
                  resolveAsset={resolveAsset}
                />
              </View>
            );
          }
          case "divider": {
            return (
              <View
                key={blockKey(index)}
                style={[styles.divider, { backgroundColor: theme.border }]}
              />
            );
          }
          case "unsupported": {
            return (
              <Notice
                key={blockKey(index)}
                text={`${block.label} — open on your desktop`}
                theme={theme}
              />
            );
          }
          case "raw": {
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
          default: {
            return null;
          }
        }
      })}
    </>
  );
};
