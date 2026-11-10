-- The search index, which sqlite-core cannot declare. `remove_diacritics 2` and `_` as a token
-- character are stated, not defaulted: the search policy's tokenizer folds and splits the same way
-- (packages/service/src/knowledge/search-query.ts). Its row id is the item's `rid`, and the cell
-- keeps it in code (packages/service/src/library/library-queries.ts), never by a trigger.
CREATE VIRTUAL TABLE `search_fts` USING fts5(
  title, headings, meta, body,
  title_stems, heading_stems, meta_stems, body_stems,
  tokenize='unicode61 remove_diacritics 2 tokenchars ''_'''
);
