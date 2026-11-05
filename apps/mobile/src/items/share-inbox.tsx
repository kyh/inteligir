import { useEffect, useRef } from "react";
import { Alert } from "react-native";
import { useShareIntentContext } from "expo-share-intent";
import type { ShareIntent } from "expo-share-intent";
import { headlessPage, newBlockId, sharedPageFetch } from "@/lib/app-runtime";
import type { PhoneLibrary } from "@/lib/compose-runtime";
import { messageOf } from "@/lib/error-message";
import { useLibrary } from "@/lib/library-hooks";
import { openItem } from "@/lib/routes";
import type { SavedItem } from "./phone-saves";
import { sharedSaveOf } from "./share-payload";
import { saveShared } from "./share-save";

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

// the save, the item opened and every refusal told; it never throws, so the share is let go after
const settleShare = async (library: PhoneLibrary, intent: ShareIntent): Promise<void> => {
  const page = headlessPage();
  let saved: SavedItem | null;
  try {
    saved = await saveShared(
      {
        newBlockId,
        ports: {
          fetch: sharedPageFetch,
          read: async (job) => {
            if (page === null) {
              throw new Error("This build has no page to read links with.");
            }
            return await page.host.read(job);
          },
        },
        replica: library.replica,
      },
      sharedSaveOf({ meta: metaOf(intent.meta), text: intent.text ?? null, webUrl: intent.webUrl }),
    );
  } catch (error) {
    Alert.alert("Couldn't save", messageOf(error));
    return;
  }
  if (saved?.kind === "refused") {
    Alert.alert("Couldn't save", saved.message);
  } else if (saved !== null) {
    openItem(saved.made.id);
  }
};

// A share from Safari, YouTube, Mail or any app is a save the app makes: the extension only hands
// it over, and this reads the page, saves it, opens the item and only then lets the share go, so
// one made while signed out (when this is not mounted) waits for the sign-in, and one made offline
// is saved as its link, for the cloud to read once it lands.
export const ShareInbox = () => {
  const library = useLibrary();
  const { hasShareIntent, resetShareIntent, shareIntent } = useShareIntentContext();
  const saving = useRef(false);

  useEffect(() => {
    if (!hasShareIntent || saving.current) {
      return;
    }
    saving.current = true;
    void (async () => {
      await settleShare(library, shareIntent);
      resetShareIntent();
      saving.current = false;
    })();
  }, [hasShareIntent, library, resetShareIntent, shareIntent]);

  return null;
};
