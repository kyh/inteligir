import { defineRelations } from "drizzle-orm";

import * as agentSchema from "./agent-schema";
import * as authSchema from "./auth-schema";
import * as librarySchema from "./library-schema";

export const relations = defineRelations({ ...agentSchema, ...authSchema, ...librarySchema });
