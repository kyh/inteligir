import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { useShareIntentContext } from "expo-share-intent";
import type { ShareIntent } from "expo-share-intent";
import type { PhoneLibrary } from "@/lib/compose-runtime";
import { messageOf } from "@/lib/error-message";
import { useLibrary } from "@/lib/library-hooks";
import { openItem } from "@/lib/routes";
import { sharedSaveOf } from "./share-payload";
import { createShareQueue } from "./share-queue";

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

// the share sent, then its item opened; one that waits or was refused is the banner's, with the
// cloud's words, until it is tried again or let go
const deliver = async (library: PhoneLibrary, opId: string): Promise<void> => {
  const outcome = await library.shares.deliver(opId);
  if (outcome.kind === "landed") {
    openItem(outcome.itemId);
  }
};

// the share kept in the outbox, which is what lets the share context go; it never throws, and
// answers "held" for a library that left under it, so the share waits for the next sign-in as a
// signed-out share does
const settleShare = async (
  library: PhoneLibrary,
  intent: ShareIntent,
): Promise<"settled" | "held"> => {
  const save = sharedSaveOf({
    meta: metaOf(intent.meta),
    text: intent.text ?? null,
    webUrl: intent.webUrl,
  });
  if (save.kind === "nothing") {
    return "settled";
  }
  let kept: Awaited<ReturnType<PhoneLibrary["shares"]["keep"]>>;
  try {
    kept = await library.shares.keep(save);
  } catch (error) {
    Alert.alert("Couldn't save", messageOf(error));
    return "settled";
  }
  if (kept === null) {
    return "held";
  }
  void deliver(library, kept.opId);
  return "settled";
};

// A share from Safari, YouTube, Mail or any app is a save the app makes: the extension only hands
// it over, and this keeps it on the phone, as its link for the cloud to read once it lands, before
// it is sent, and only then lets the share go, so one made offline waits in the outbox and one made
// while signed out (when this is not mounted) waits for the sign-in.
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
