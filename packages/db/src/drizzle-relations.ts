import { defineRelations } from "drizzle-orm";

import * as authSchema from "./auth-schema";

// every table, though none relates to another: Better Auth's drizzle adapter finds its models here
export const relations = defineRelations(authSchema);
