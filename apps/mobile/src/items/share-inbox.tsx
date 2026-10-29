import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useShareIntentContext } from "expo-share-intent";
import type { ShareIntent } from "expo-share-intent";
import { saveLink, saveText } from "@/lib/app-runtime";
import { messageOf } from "@/lib/error-message";
import { openItem } from "@/lib/routes";
import type { SavedItem } from "./item-ops";
import { sharedSaveOf } from "./share-payload";

// the page's meta tags as the extension read them, without the ones it found empty
const metaOf = (meta: ShareIntent["meta"]): Record<string, string> | null => {
  if (meta === null || meta === undefined) {
    return null;
  }
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value !== undefined) {
      kept[key] = value;
    }
  }
  return kept;
};

const saveShared = async (intent: ShareIntent): Promise<SavedItem | null> => {
  const shared = sharedSaveOf({
    meta: metaOf(intent.meta),
    text: intent.text ?? null,
    webUrl: intent.webUrl,
  });
  switch (shared.kind) {
    case "link": {
      return await saveLink(shared);
    }
    case "text": {
      return await saveText(shared.text);
    }
    case "nothing": {
      return null;
    }
    // no default
  }
};

// the save, the item opened and every refusal told; it never throws, so the share is let go after
const settleShare = async (intent: ShareIntent): Promise<void> => {
  let saved: SavedItem | null;
  try {
    saved = await saveShared(intent);
  } catch (error) {
    Alert.alert("Couldn't save", messageOf(error));
    return;
  }
  if (saved?.kind === "refused") {
    Alert.alert("Couldn't save", saved.message);
  } else if (saved !== null) {
    openItem(saved.path);
  }
};

// A share from Safari, YouTube, Mail or any app is a save the app makes: the extension only hands
// it over, and this saves it, opens the item and only then lets the share go, so one made while
// signed out (when this is not mounted) waits for the sign-in.
export const ShareInbox = () => {
  const { hasShareIntent, resetShareIntent, shareIntent } = useShareIntentContext();
  const saving = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || saving.current) {
      return;
    }
    saving.current = true;
    void (async () => {
      await settleShare(shareIntent);
      resetShareIntent();
      saving.current = false;
    })();
  }, [hasShareIntent, resetShareIntent, shareIntent]);

  return null;
};
