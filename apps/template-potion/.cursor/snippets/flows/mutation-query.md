# Creating New Mutations and Queries

Follow these steps in order, using existing files as references:

1. Update Schema

   - Edit `packages/db/prisma/schema.prisma`
   - Run `prisma generate` and `prisma db push`
   - Reference: Existing models in `schema.prisma`

2. Create or Update Router

   - Location: `packages/trpc/src/lib/routers/<feature>/<feature>.router.ts`
   - Use `protectedProcedure` for authenticated routes
   - Use `publicProcedure` for public routes. Choose wisely if it can be public depending on project specs.
   - Import `prisma` from `@app/db`
   - Reference: `packages/trpc/src/lib/routers/comment/comment.router.ts`

3. Update App Router

   - File: `packages/trpc/src/lib/routers/app.router.ts`
   - Import the new router and add it to the `appRouter`
   - Reference: Existing router imports and additions

4. Create Query File

   - Location: `apps/web/src/hooks/queries/query-<feature>.tsx`
   - Use the `createClientQuery` pattern
   - Reference: `apps/web/src/hooks/queries/query-template.tsx` or `query-discussions.tsx`

5. Update API Hook

   - File: `apps/web/src/hooks/queries/useApi.ts`
   - Import the new query and add it to the appropriate object
   - Maintain the existing structure (e.g., `document`, `version`, etc.)
   - Only add queries, not mutations
   - Reference: Existing structure in `useApi.ts`

6. Create Mutation Hook (if needed)

   - Location: `apps/web/src/hooks/mutations/use<Action><Feature>Mutation.ts`
   - Reference: `apps/web/src/hooks/mutations/useCreateCommentMutation.ts`

7. Implement in Components

   - Use the mutation/query hooks in relevant components
   - Reference: `apps/web/src/components/settings/settings-modal.tsx` or similar components
   - Use React Query options as needed:
     - `enabled: boolean`: disable when input schema is invalid
     - `placeholderData: keepPreviousData`: use when relevant
   - Example query:

```ts
const [data, { isLoading }] = useQuery({
  ...trpc.document.documents.queryOptions({
    // ... input parameters
  }),
  enabled: !!someCondition,
});
```

Remember:

- Always check the existing structure in `useApi.ts` before adding new queries
- Maintain consistency with the project's patterns and file structures
- Use `useAuthGuard` for protected actions in components
- Keep code consistent with the project's patterns
- Always refer to existing files for patterns and conventions
