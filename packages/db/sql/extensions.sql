-- The extensions search and meaning lean on, applied by `push` before drizzle-kit's, which declares none.
create extension if not exists pg_trgm;
create extension if not exists unaccent;
create extension if not exists vector;
