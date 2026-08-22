-- No schema change. Exists because a pre-merge interim of 0007 rebuilt
-- `threads` without its meta bump, leaving that db on the final schema but
-- stuck at version '7' — this generation names itself like every other, which
-- carries the stragglers forward too.
UPDATE `meta` SET `value` = '9' WHERE `key` = 'schema_version';
