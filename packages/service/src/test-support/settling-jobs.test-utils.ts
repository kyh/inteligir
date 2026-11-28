import { job } from "@repo/db/library-schema";
import { notInArray } from "drizzle-orm";

export const notSettling = notInArray(job.kind, ["auto-file", "meaning"]);
