import * as authSchema from "@repo/db/auth-schema";
import { dbSuite } from "@repo/db/test-database";
import { getAuthTables } from "better-auth/db";
import { getColumns, is, Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getAuth, getSignUpAuth } from "./auth";

const drizzleTables = new Map<string, Table>(
  Object.entries(authSchema).flatMap(([key, value]) => (is(value, Table) ? [[key, value]] : [])),
);

type AuthTable = ReturnType<typeof getAuthTables>[string];

const fieldNamesOf = (authTable: AuthTable) =>
  Object.entries(authTable.fields).map(([key, field]) => field.fieldName ?? key);

const tableOf = (authTable: AuthTable) => {
  const table = drizzleTables.get(authTable.modelName);

  if (table === undefined) {
    throw new Error(`no table is exported as ${authTable.modelName}`);
  }

  return table;
};

dbSuite("the auth tables", () => {
  for (const [name, instance] of Object.entries({ signIn: getAuth(), signUp: getSignUpAuth() })) {
    it(`hold every table and column ${name}'s instance writes`, async () => {
      const { explicitSchemaCheck } = await instance.$context;
      expect(explicitSchemaCheck, "the drizzle adapter registers a schema check").toBeDefined();
      await explicitSchemaCheck?.();
    });
  }

  for (const [key, authTable] of Object.entries(getAuthTables(getAuth().options))) {
    describe(key, () => {
      it("declares no column Better Auth does not know", () => {
        const known = new Set([...fieldNamesOf(authTable), "id"]);

        const extra = Object.keys(getColumns(tableOf(authTable))).filter(
          (property) => !known.has(property),
        );

        expect(extra).toStrictEqual([]);
      });

      it("matches Better Auth on which columns are NOT NULL", () => {
        const columns = getColumns(tableOf(authTable));

        const mismatched = Object.entries(authTable.fields).flatMap(([fieldKey, field]) => {
          const fieldName = field.fieldName ?? fieldKey;
          const required = field.required === true;
          const column = columns[fieldName];

          return column !== undefined && column.notNull !== required
            ? [`${fieldName}: expected notNull=${String(required)}`]
            : [];
        });

        expect(mismatched).toStrictEqual([]);
      });
    });
  }
});
