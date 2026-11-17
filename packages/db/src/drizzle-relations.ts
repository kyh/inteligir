import { defineRelations } from "drizzle-orm";

import * as authSchema from "./auth-schema";
import * as librarySchema from "./library-schema";

// every table, though none relates to another: Better Auth's drizzle adapter finds its models here
export const relations = defineRelations({ ...authSchema, ...librarySchema });
