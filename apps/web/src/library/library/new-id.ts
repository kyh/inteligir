import { uuidV7 } from "@repo/contract/library/uuid-v7";

export const newId = () => uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(16)));
