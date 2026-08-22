# Vendored: moss-skills

- **Upstream**: https://github.com/brsbl/moss-skills, directory `skills/`
- **Commit**: `2f1c18baa74c60b0034dabf0a32b120df8c1bf0b`
- **License**: MIT — `LICENSE.moss-skills` in this directory is upstream's own
  text, copied verbatim. It names the copyright holder no notice line carries.
- **Vendored**: 2026-08-21

The Moss dialect's first-party specification (issue #581): the persisted
grammar for notes, links, formulas/variables, comments, canvas, HTML blocks and
frontmatter that this repo's serializer implements and its agents are taught.
Vendored rather than referenced because the skills are the CONTRACT — the
serializer's fixtures and the agents' instructions must move with the pin, not
with upstream's HEAD. Upstream's own README states the customization rule this
repo obeys: how agents APPLY the syntax may be adapted; the syntax itself may
not.

## Attribution

The notice the sweep looks for, were any file to carry one:

```text
Vendored from moss-skills (github.com/brsbl/moss-skills), MIT.
```

Skill files are kept byte-faithful to upstream — they are prompt material an
agent reads verbatim, and a header would ride into every prompt — so no
per-file notice is injected (the sweep tracks code files; markdown is outside
its universe). The license travels beside them in this directory instead.
