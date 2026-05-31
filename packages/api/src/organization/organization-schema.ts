import { z } from "zod";

export const getOrganizationInput = z.object({
  slug: z.string(),
});
