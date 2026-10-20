// The phone page in its reader mode: a WebView nothing shows, mounted while the phone is signed in,
// that reads the links this phone saves (fill-page-host.ts). It loads the page the app bundle
// carries and nothing else: no other address, no frame, no window.
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { readerPage } from "@/lib/app-runtime";
import { sameDocument } from "@/lib/same-document";

// one point square, under everything: a WebView with no frame at all may never run its page
const HIDDEN = { height: 1, left: 0, opacity: 0, position: "absolute", top: 0, width: 1 } as const;

// the WebView hands anything its list does not admit to the OS itself, before the handler below
// runs, so the list admits every address and the handler is the one policy
const EVERY_ORIGIN = ["*"];

export const ReaderPage = () => {
  const reader = readerPage();
  if (reader === null) {
    return null;
  }
  const { host, source } = reader;
  const { attach: attachView } = host;
  const handleTerminated = (): void => {
    host.reload();
  };
  return (
    <View pointerEvents="none" style={HIDDEN}>
      <WebView
        ref={attachView}
        source={{ uri: source.uri }}
        allowingReadAccessToURL={source.readAccess}
        originWhitelist={EVERY_ORIGIN}
        onShouldStartLoadWithRequest={(request) =>
          request.isTopFrame && sameDocument(request.url, source.uri)
        }
        onOpenWindow={() => {
          // the reader opens no window
        }}
        onMessage={(event) => {
          host.receive({ data: event.nativeEvent.data, url: event.nativeEvent.url });
        }}
        onContentProcessDidTerminate={handleTerminated}
        webviewDebuggingEnabled={__DEV__}
      />
    </View>
  );
};
