// An item's file full size, by the item's id: a picture zoomable, a PDF in a WebView that runs no
// script and loads nothing but the file, from the phone's file cache, which fetches it from the
// cloud the first time and keeps it after, until iOS clears its cache. A file of another kind says
// so.

import { shownTitle } from "@repo/contract/items/item-name";
import { UNREACHABLE } from "@repo/contract/library/call-outcome";
import { Stack, useLocalSearchParams } from "expo-router";
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
import { EVERY_ORIGIN } from "@/editor/web-view-policy";
import { useFileUri, useItem } from "@/lib/library-hooks";
import { firstParam } from "@/lib/routes";
import { sameDocument } from "@/lib/same-document";
import { screenStyle, useTheme } from "@/lib/theme";

const CENTERED = "grow basis-0 items-center justify-center";

const MAX_ZOOM = 5;

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

const DocumentView = ({ uri }: { uri: string }) => {
  const theme = useTheme();
  return (
    <WebView
      style={screenStyle(theme)}
      source={{ uri }}
      allowingReadAccessToURL={uri}
      originWhitelist={EVERY_ORIGIN}
      onShouldStartLoadWithRequest={(request) => sameDocument(request.url, uri)}
      javaScriptEnabled={false}
      allowsLinkPreview={false}
      dataDetectorTypes="none"
    />
  );
};

const Centered = ({ children }: { children: string }) => (
  <View className={CENTERED}>
    <Text className="px-6 text-center text-16 text-muted-foreground">{children}</Text>
  </View>
);

const ViewerScreen = () => {
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const read = useItem(firstParam(params.id) ?? "");
  const item = read.kind === "held" ? read.item : null;
  const sha = item?.fields.originalSha ?? null;
  const kind = item?.fields.kind ?? null;
  const shown = kind === "image" || kind === "pdf";
  const uri = useFileUri(shown ? sha : null);

  let body = (
    <View className={CENTERED}>
      <ActivityIndicator />
    </View>
  );
  if (read.kind === "missing" || (item !== null && sha === null)) {
    body = <Centered>This file is not in your library.</Centered>;
  } else if (read.kind === "unreachable") {
    body = <Centered>{UNREACHABLE}</Centered>;
  } else if (item !== null && !shown) {
    body = <Centered>This file opens on your Mac.</Centered>;
  } else if (uri === null) {
    body = (
      <Centered>
        This file is not on this iPhone yet. It comes once your library can be reached.
      </Centered>
    );
  } else if (uri !== undefined) {
    body = kind === "pdf" ? <DocumentView uri={uri} /> : <ImageView uri={uri} />;
  }

  return (
    <SafeAreaView style={screenStyle(theme)} edges={["left", "right", "bottom"]}>
      <Stack.Screen
        options={{
          title: item === null ? "" : shownTitle(item.card.title),
        }}
      />
      {body}
    </SafeAreaView>
  );
};

export default ViewerScreen;
