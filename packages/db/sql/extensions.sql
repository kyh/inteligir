-- The extensions search leans on, applied by `push` before drizzle-kit's, which declares none.
create extension if not exists pg_trgm;
create extension if not exists unaccent;
