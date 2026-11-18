# inteligir Formulas And Variables

A pill holds a computed or reusable value inline. A source is enough for a one-off
calculation; a name makes it something other pills in the same item can read.

## The Grammar

```text
:formula[display]{source="source"}
:formula[display]{name="name" source="source"}
```

`display` sits in the brackets, `source` and the optional `name` in quoted
attributes, and no other attribute. A `"` inside `source` is written `&#x22;`.
`read_item` writes a backslash before a mark in the display that markdown would
read as formatting (`` ` ``, `*`, `_`, `~`, `$`, `&`, `<`, `[`, `]`, `:`, `|`,
`\`), so `:formula[1,000]{source="1000"}` reads as it is written.

`display` is what the reader sees, and the app derives it from `source` wherever a
pill is written: what you put in the brackets is replaced by what the source
gives. Write the value you expect, and read the item again when the number matters.

| Kind                | Written as                                            |
| ------------------- | ----------------------------------------------------- |
| One-off calculation | `:formula[4]{source="2+2"}`                           |
| Named value         | `:formula[16]{name="base_size" source="16"}`          |
| Derived value       | `:formula[32]{source="base_size*2"}`                  |
| Named text          | `:formula[6 weeks]{name="timeline" source="6 weeks"}` |

## What Computes

Arithmetic only: `+ - * / ( )`, decimals, `$`, thousands commas, `%`, `k`/`m`/`b`
magnitude suffixes in either case, and the names of other pills. No functions, no
exponentiation. Any other source is text, and the pill shows it as written.

Results carry thousands separators and at most two decimals. `$` and `%` shape
the parse; they do not decorate the result.

## Names

A name starts with a letter and holds letters, digits and `_`, never `-`, which a
source reads as minus. A source reads a pill by its name, in the same item only:

```markdown
:formula[16]{name="base_size" source="16"}

:formula[32]{name="double_size" source="base_size*2"}
```

That is the whole point of named pills: define an anchor once, derive from it,
and changing the anchor moves everything downstream.

- A pill whose source is only a name shows what that pill shows, so a named text
  can be repeated: `:formula[6 weeks]{source="timeline"}`.
- A source that reads a name no pill in the item holds, that reads itself, or
  that divides by zero has no value, and its pill shows the source instead.
- Give each name to one pill. Where two share a name, a source reads the first.
- Renaming a pill does not rename what reads it: rewrite every source that used
  the old name in the same edit.
- No pill reads a pill of another item. Write the value there instead.

## In Tables

A pill can sit in a table cell as it is written anywhere else:

```markdown
| Plan    | Cost                           |
| ------- | ------------------------------ |
| Monthly | :formula[1,000]{source="1000"} |
```

A pipe ends the cell, so one inside a pill there is `\|` in its display and
`&#x7C;` in its source.

## Before You Finish

- Every name a source reads is the name of a pill in the same item.
- No two pills share a name.
- Each display is what its source gives.
- Literal syntax examples are inside backticks, so they stay text.
