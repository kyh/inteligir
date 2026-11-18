// The orders a list of the library is browsed in: newest saved, last changed, or by title. A module
// of its own, zod alone, so the tab's preferences read it without the library's wire, which every
// page of the site would then carry.

import { z } from "zod";

export const listingSortSchema = z.enum(["saved", "modified", "title"]);
