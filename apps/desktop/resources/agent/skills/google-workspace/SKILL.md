---
name: google-workspace
description: >
  Access Google Workspace services (Gmail, Calendar, Drive, Docs, Sheets,
  Slides, Tasks, Contacts, Chat, Meet, Admin, etc.) via the gws CLI.
  Use when the user mentions email, calendar, meetings, files, documents,
  spreadsheets, or any Google service.
---

# Google Workspace

Interact with the full Google Workspace suite via `gws` through the bash tool.
All output is structured JSON.

## Auth

Before using any command, check auth status:

```bash
gws auth status
```

If not authenticated, start the OAuth flow:

```bash
gws auth login
```

This opens the user's browser for Google consent. Tell the user to complete
the flow there. Once done, tokens are stored locally and refresh automatically.

## Command Syntax

```bash
gws <service> <resource> <method> [flags]
```

Common flags:

- `--params '{...}'` — query/path parameters as JSON
- `--json '{...}'` — request body as JSON
- `--page-all` — auto-paginate and stream all results as NDJSON
- `--dry-run` — preview the request without executing

Discover available services and commands:

```bash
gws <service> --help
```

## Helper Commands (+shortcuts)

Prefixed with `+`, these are high-level workflows:

### Gmail

```bash
gws gmail +triage                                    # inbox summary
gws gmail +send --to a@b.com --subject "Hi" --body "Hello"
gws gmail +reply --message-id <id> --body "Thanks"
gws gmail +reply-all --message-id <id> --body "ACK"
gws gmail +forward --message-id <id> --to c@d.com
gws gmail messages list --params '{"q":"is:unread","maxResults":10}'
gws gmail messages get --params '{"id":"<id>","userId":"me"}'
```

### Calendar

```bash
gws calendar +agenda                                 # upcoming events
gws calendar +agenda --timezone America/New_York
gws calendar +insert --summary "Meeting" --start "YYYY-MM-DDTHH:MM:SS" --end "YYYY-MM-DDTHH:MM:SS"
gws calendar events list --params '{"calendarId":"primary","maxResults":10}'
```

### Drive

```bash
gws drive +upload ./file.pdf --name "Report"
gws drive files list --params '{"pageSize":10}'
gws drive files get --params '{"fileId":"<id>"}'
```

### Docs

```bash
gws docs +write --title "Meeting Notes" --body "# Notes\n\nContent here"
gws docs documents get --params '{"documentId":"<id>"}'
```

### Sheets

```bash
gws sheets +read --spreadsheet-id <id> --range "Sheet1!A1:C10"
gws sheets +append --spreadsheet-id <id> --range "Sheet1" --values '[["a","b"],["c","d"]]'
gws sheets spreadsheets create --json '{"properties":{"title":"Budget"}}'
```

### Slides

```bash
gws slides presentations create --json '{"title":"Deck"}'
gws slides presentations get --params '{"presentationId":"<id>"}'
```

### Tasks

```bash
gws tasks tasklists list
gws tasks tasks list --params '{"tasklist":"<id>"}'
gws tasks tasks insert --params '{"tasklist":"<id>"}' --json '{"title":"Do thing"}'
```

### Contacts (People API)

```bash
gws people people.connections list --params '{"resourceName":"people/me","personFields":"names,emailAddresses"}'
```

### Chat

```bash
gws chat spaces list
gws chat spaces.messages create --params '{"parent":"spaces/<id>"}' --json '{"text":"Hello"}'
```

### Meet

```bash
gws meet conferenceRecords list
```

### Admin

```bash
gws admin users list --params '{"domain":"example.com"}'
```

## Workflow Shortcuts

Higher-level multi-step workflows:

```bash
gws workflow +standup-report     # summarize recent activity for standup
gws workflow +meeting-prep       # prepare briefing for upcoming meetings
gws workflow +email-to-task      # convert flagged emails to tasks
gws workflow +weekly-digest      # generate weekly activity digest
gws workflow +file-announce      # share a file and notify via chat
```

## Tips

- All responses are JSON. Parse with `jq` if needed.
- Use `--page-all` for large result sets (streams NDJSON).
- Use `gws schema <service>.<resource>.<method>` to inspect request/response schemas.
- If a command fails with an auth error, re-run `gws auth login`.
- For any service not listed here, run `gws <service> --help` to discover commands.
