import { z } from "zod";

export const listingSortSchema = z.enum(["saved", "modified", "title"]);
