// The ids the library mints itself: an item or a folder a write makes is a UUID version 7, as a
// device's own are, so ids sort by when they were made (RFC 9562 § 5.7).

import { randomBytes } from "node:crypto";

import { uuidV7 } from "@repo/contract/library/uuid-v7";

export const mintLibraryId = (now: number): string => uuidV7(now, randomBytes(16));
