import { randomBytes } from "node:crypto";

import { uuidV7 } from "@repo/contract/library/uuid-v7";

export const mintLibraryId = (now: number) => uuidV7(now, randomBytes(16));
