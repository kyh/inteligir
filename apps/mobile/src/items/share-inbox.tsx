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

const metaOf = (meta: ShareIntent["meta"]) => {
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

const deliver = async (library: PhoneLibrary, opId: string) => {
  const itemId = await library.shares.deliver(opId);

  if (itemId !== null) {
    openItem(itemId);
  }
};

const settleShare = async (library: PhoneLibrary, intent: ShareIntent) => {
  const save = sharedSaveOf({
    meta: metaOf(intent.meta),
    text: intent.text ?? null,
    webUrl: intent.webUrl,
  });

  if (save.kind === "nothing") {
    return "settled" as const;
  }

  let kept: Awaited<ReturnType<PhoneLibrary["shares"]["keep"]>>;

  try {
    kept = await library.shares.keep(save);
  } catch (error) {
    Alert.alert("Couldn't save", messageOf(error));

    return "settled" as const;
  }

  if (kept === null) {
    return "held" as const;
  }

  void deliver(library, kept.opId);

  return "settled" as const;
};

export const ShareInbox = () => {
  const library = useLibrary();
  const { hasShareIntent, resetShareIntent, shareIntent } = useShareIntentContext();
  // oxlint-disable-next-line react/hook-use-state -- a per-mount constant: React's lazy initializer, no setter exists
  const [queue] = useState(createShareQueue<ShareIntent>);

  useEffect(() => {
    queue.offer(hasShareIntent ? shareIntent : null, {
      reset: resetShareIntent,
      settle: async (intent) => await settleShare(library, intent),
    });
  }, [hasShareIntent, library, queue, resetShareIntent, shareIntent]);

  return null;
};
