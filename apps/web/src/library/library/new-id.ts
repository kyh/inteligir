import { uuidV7 } from "@repo/contract/library/uuid-v7";

// an item's or a folder's id, minted on this page so a write that goes twice makes it once
export const newId = (): string => uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(16)));
