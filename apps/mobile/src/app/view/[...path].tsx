import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { fileKindOf, PAGES_DIR } from "@repo/notes/items/item-kind";
import { basenamePath, dirnamePath, extnamePath } from "@repo/notes/knowledge/vault-path";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { attachmentFile } from "@/lib/app-runtime";
import { firstParam, openItem } from "@/lib/routes";
import { SPACE, useTheme } from "@/lib/theme";

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, justifyContent: "center" },
  screen: { flex: 1 },
  status: { fontSize: 16, paddingHorizontal: SPACE.xxl, textAlign: "center" },
});

const MAX_ZOOM = 5;

// the WebView hands anything its list does not admit to the OS itself, before the handler below
// runs, so the list admits every address and the handler is the one policy: the PDF, nothing else
const EVERY_ORIGIN = ["*"];

type Held =
  | { kind: "loading" }
  | { kind: "held"; uri: string }
  | { kind: "failed"; message: string };

// the original's bytes on this phone, downloaded on the first ask; nothing remote ever loads here,
// and a file the phone cannot show (null) is never downloaded
const useHeldFile = (path: string | null): Held => {
  const [held, setHeld] = useState<{ path: string; held: Held } | null>(null);
  useEffect(() => {
    if (path === null) {
      return;
    }
    let live = true;
    void (async () => {
      const read = await attachmentFile(path);
      if (live) {
        setHeld({
          held: read.ok
            ? { kind: "held", uri: read.uri }
            : { kind: "failed", message: read.message },
          path,
        });
      }
    })();
    return () => {
      live = false;
    };
  }, [path]);
  return held?.path === path ? held.held : { kind: "loading" };
};

const ImageView = ({ uri }: { uri: string }) => {
  const { height, width } = useWindowDimensions();
  return (
    <ScrollView
      centerContent
      maximumZoomScale={MAX_ZOOM}
      minimumZoomScale={1}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      <Image
        accessibilityIgnoresInvertColors
        resizeMode="contain"
        source={{ uri }}
        style={{ height: height * 0.8, width }}
      />
    </ScrollView>
  );
};

// a page's copy the Mac kept: one html file with nothing in it that runs or loads
const isPageCopy = (path: string): boolean =>
  dirnamePath(path) === PAGES_DIR && extnamePath(path).toLowerCase() === ".html";

// the cached PDF in WebKit's own viewer, or a page's copy, with no script, reading only the folder
// it sits in and following no link out of it
const HeldDocumentView = ({ uri }: { uri: string }) => {
  const theme = useTheme();
  return (
    <WebView
      style={[styles.screen, { backgroundColor: theme.background }]}
      source={{ uri }}
      allowingReadAccessToURL={dirnamePath(uri)}
      originWhitelist={EVERY_ORIGIN}
      onShouldStartLoadWithRequest={(request) => request.url === uri}
      javaScriptEnabled={false}
      allowsLinkPreview={false}
      dataDetectorTypes="none"
    />
  );
};

// One image, PDF or page copy full size, from the file this phone holds of it; Edit opens the
// item it belongs to in the editor, and a file that is an item of its own has none. Any other file
// says where it opens.
const ViewerScreen = () => {
  const theme = useTheme();
  const params = useLocalSearchParams<{ path: string[]; item?: string | string[] }>();
  const path = Array.isArray(params.path) ? params.path.join("/") : (params.path ?? "");
  const item = firstParam(params.item);
  const kind = fileKindOf(path);
  const asDocument = kind === "pdf" || isPageCopy(path);
  const shown = asDocument || kind === "image";
  const held = useHeldFile(shown ? path : null);

  let body = (
    <View style={styles.center}>
      <ActivityIndicator />
    </View>
  );
  if (!shown) {
    body = (
      <View style={styles.center}>
        <Text style={[styles.status, { color: theme.mutedForeground }]}>
          This file opens on your Mac.
        </Text>
      </View>
    );
  } else if (held.kind === "failed") {
    body = (
      <View style={styles.center}>
        <Text style={[styles.status, { color: theme.mutedForeground }]}>
          {`This file isn't on your phone yet: ${held.message}`}
        </Text>
      </View>
    );
  } else if (held.kind === "held") {
    body = asDocument ? <HeldDocumentView uri={held.uri} /> : <ImageView uri={held.uri} />;
  }

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.background }]}
      edges={["left", "right", "bottom"]}
    >
      <Stack.Screen options={{ title: item === null ? basenamePath(path) : docStem(item) }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          hidden={item === null}
          onPress={() => {
            if (item !== null) {
              openItem(item);
            }
          }}
        >
          Edit
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      {body}
    </SafeAreaView>
  );
};

export default ViewerScreen;
