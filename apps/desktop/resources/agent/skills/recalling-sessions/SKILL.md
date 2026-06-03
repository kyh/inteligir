---
name: recalling-sessions
description: >
  Search your own past conversations. Use when the user refers to something
  from before ("like we did last week", "that thing I asked you about"), when
  you need a decision/detail/file path from an earlier session, or when you
  want continuity across sessions that the current transcript doesn't carry.
---

# Recalling past sessions

Each conversation is recorded as an append-only **JSONL** file. You can search
across all of them with `bash` + `grep` — no special tool needed. This is how
you get cross-session memory: the current session only carries its own
transcript, but every prior session is on disk.

## Where sessions live

```
~/.inteligir/sessions/<path>/<timestamp>_<id>.jsonl
```

Sessions are nested one directory deep, so list them with `find` (a bare `**`
glob needs `globstar` and silently misses nested files). Most-recently-modified
first:

```bash
ls -t $(find ~/.inteligir/sessions -name '*.jsonl') 2>/dev/null | head
```

(One `ls -t` call sorts everything by mtime; `find` handles any nesting. Session
filenames have no spaces, so the unquoted expansion is safe.)

## Searching

Each line is one JSON entry (a message, tool call, or tool result). Plain
text search across everything:

```bash
grep -ril "keyword" ~/.inteligir/sessions/        # which sessions mention it
grep -rin "keyword" ~/.inteligir/sessions/ | head  # the matching lines
```

Once you've found the right file, read around the hit for context. The file is
chronological, so a few lines before/after a match usually tell the story:

```bash
grep -n "keyword" <file>          # find line numbers
sed -n '40,70p' <file>            # read that span
```

For a readable digest of a session rather than raw JSON, just `read` the file
and summarize it yourself — you parse the JSON fine.

## Tips

- Search a few candidate keywords; conversations rarely use the exact phrasing
  you remember.
- Prefer the most recent matching session unless the user points further back.
- Don't dump raw JSONL at the user — extract the answer and synthesize it.
- If you find a durable fact worth keeping (a preference, a decision, a path),
  consider capturing it as a skill (see the managing-skills skill) so you don't
  have to re-discover it.
