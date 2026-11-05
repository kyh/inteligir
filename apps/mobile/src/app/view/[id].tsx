// An item's file full size, by the item's id: a picture zoomable, a PDF in a WebView that runs no
// script and loads nothing but the file, from the phone's file cache, which fetches it from the
// cloud the first time and keeps it offline after. A file of another kind says so.

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
import { useFileUri, useItem } from "@/lib/library-hooks";
import { firstParam } from "@/lib/routes";
import { sameDocument } from "@/lib/same-document";
import { useTheme } from "@/lib/theme";

const screenOf = (background: string) => ({ backgroundColor: background, flex: 1 });

const CENTERED = "grow basis-0 items-center justify-center";

const MAX_ZOOM = 5;

// the WebView hands anything its list does not admit to the OS itself, before the policy below
// runs, so the list admits every address and the policy is the one rule
const EVERY_ORIGIN = ["*"];

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
      style={screenOf(theme.background)}
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
  const item = useItem(firstParam(params.id) ?? "");
  const sha = item?.fields.originalSha ?? null;
  const kind = item?.fields.kind ?? null;
  const shown = kind === "image" || kind === "pdf";
  const uri = useFileUri(shown ? sha : null);

  let body = (
    <View className={CENTERED}>
      <ActivityIndicator />
    </View>
  );
  if (item === null || (item !== undefined && sha === null)) {
    body = <Centered>This file is not in your library on this iPhone.</Centered>;
  } else if (item !== undefined && !shown) {
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
    <SafeAreaView style={screenOf(theme.background)} edges={["left", "right", "bottom"]}>
      <Stack.Screen options={{ title: item?.card.title ?? "" }} />
      {body}
    </SafeAreaView>
  );
};

export default ViewerScreen;
