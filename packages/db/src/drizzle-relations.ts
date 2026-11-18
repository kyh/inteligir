import { defineRelations } from "drizzle-orm";

import * as agentSchema from "./agent-schema";
import * as authSchema from "./auth-schema";
import * as librarySchema from "./library-schema";

// every table, though none relates to another: Better Auth's drizzle adapter finds its models here
export const relations = defineRelations({ ...agentSchema, ...authSchema, ...librarySchema });
