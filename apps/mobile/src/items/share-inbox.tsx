import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { useShareIntentContext } from "expo-share-intent";
import type { ShareIntent } from "expo-share-intent";
import { headlessPage, newBlockId, sharedPageFetch } from "@/lib/app-runtime";
import type { PhoneLibrary } from "@/lib/compose-runtime";
import { messageOf } from "@/lib/error-message";
import { useLibrary } from "@/lib/library-hooks";
import { openItem } from "@/lib/routes";
import { sharedSaveOf } from "./share-payload";
import { createShareQueue } from "./share-queue";
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

// the save, the item opened and every refusal told; it never throws, so the share is let go after,
// unless its library left under it, when it waits for the next sign-in as a signed-out share does
const settleShare = async (
  library: PhoneLibrary,
  intent: ShareIntent,
): Promise<"settled" | "held"> => {
  const page = headlessPage();
  let saved: Awaited<ReturnType<typeof saveShared>>;
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
    return "settled";
  }
  if (saved?.kind === "left") {
    return "held";
  }
  if (saved?.kind === "refused") {
    Alert.alert("Couldn't save", saved.message);
  } else if (saved !== null) {
    openItem(saved.made.id);
  }
  return "settled";
};

// A share from Safari, YouTube, Mail or any app is a save the app makes: the extension only hands
// it over, and this reads the page, saves it, opens the item and only then lets the share go, so
// one made while signed out (when this is not mounted) waits for the sign-in, and one made offline
// is saved as its link, for the cloud to read once it lands.
export const ShareInbox = () => {
  const library = useLibrary();
  const { hasShareIntent, resetShareIntent, shareIntent } = useShareIntentContext();
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [queue] = useState(createShareQueue<ShareIntent>);

  // a share made while another settles waits its turn (`./share-queue`)
  useEffect(() => {
    queue.offer(hasShareIntent ? shareIntent : null, {
      reset: resetShareIntent,
      settle: async (intent) => await settleShare(library, intent),
    });
  }, [hasShareIntent, library, queue, resetShareIntent, shareIntent]);

  return null;
};
