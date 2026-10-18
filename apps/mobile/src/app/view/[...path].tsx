import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
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
import { sameDocument } from "@/lib/same-document";
import { useTheme } from "@/lib/theme";

// a value, not a class: className draws nothing on a SafeAreaView or a WebView
const screenOf = (background: string) => ({ backgroundColor: background, flex: 1 });

// the body's frame for a spinner or a line, the whole screen with its one child in the middle
const CENTERED = "grow basis-0 items-center justify-center";

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
// it sits in and following no link out of it: the one document, in whatever escapes WebKit hands
// back and with any fragment it adds
const HeldDocumentView = ({ uri }: { uri: string }) => {
  const theme = useTheme();
  return (
    <WebView
      style={screenOf(theme.background)}
      source={{ uri }}
      allowingReadAccessToURL={dirnamePath(uri)}
      originWhitelist={EVERY_ORIGIN}
      onShouldStartLoadWithRequest={(request) => sameDocument(request.url, uri)}
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
    <View className={CENTERED}>
      <ActivityIndicator />
    </View>
  );
  if (!shown) {
    body = (
      <View className={CENTERED}>
        <Text className="px-6 text-center text-16 text-muted-foreground">
          This file opens on your Mac.
        </Text>
      </View>
    );
  } else if (held.kind === "failed") {
    body = (
      <View className={CENTERED}>
        <Text className="px-6 text-center text-16 text-muted-foreground">
          {`This file isn't on your phone yet: ${held.message}`}
        </Text>
      </View>
    );
  } else if (held.kind === "held") {
    body = asDocument ? <HeldDocumentView uri={held.uri} /> : <ImageView uri={held.uri} />;
  }

  return (
    <SafeAreaView style={screenOf(theme.background)} edges={["left", "right", "bottom"]}>
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
