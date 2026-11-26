# Releasing

THE runbook. One product version ships as three artifacts, and every step here
runs on the owner's machine: each needs a credential no CI run holds (the
Developer ID and the notary key, the Apple team behind EAS, production's
database). An agent there can pack and publish the Mac app; production's
schema push and the store uploads stay the owner's.

| Artifact       | Who gets it                                                     | How it ships                                                         |
| -------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| The Mac app    | the site's Download button, and every installed app's updater   | a GitHub release carrying the dmg, the zip and `latest-mac.yml`      |
| The iPhone app | TestFlight: the internal `Owner` group, then the `Cohort` group | `pnpm testflight:mobile` (EAS Build, submitted to App Store Connect) |
| The extension  | the Chrome Web Store, for Chrome, Arc, Brave, Edge and Vivaldi  | `pnpm package:extension`, uploaded to the store item                 |

The three read one version, the root `package.json`'s (set in § 1), since one
client build floor holds the phone and the extension alike, and a release's
notes are `CHANGELOG.md`'s top section, which
`apps/desktop/scripts/release-notes.ts` refuses to print until it is titled
for that version.

The cloud is not one of them: every push to main deploys production on the
Vercel project `inteligir`, which serves inteligir.com once its checks pass
(Once per product: the deployment's checks). **The order is the rule**: the
production schema, then the cloud, then any build that calls a route the cloud
just gained. An app ahead of its cloud fails every such call; a cloud ahead of
its apps costs nothing, because `/v1` breaks a build only once
`MIN_CLIENT_BUILD` (`packages/service/src/env.ts`) is raised past it, which
retires a wire shape on purpose and is never part of a release by default.

**The first outside tester ends the no-users premise** (`AGENTS.md` § Project
Overview). Before anyone outside the team gets a build, through the `Cohort`
group or an invite code, strike that premise from `AGENTS.md`:
from that build on, a format change migrates.

The owner publishes once, when every step up to § 6 and every check in § 5 has
passed; § 7's checks need the published release.

## Once per machine

- **`.release/`** (gitignored) at the repo root: `release.env` and the
  notary's `.p8`, with the Developer ID Application certificate in the login
  keychain (`security find-identity -v -p codesigning` lists it). `release.env`
  is all a pack signs with, under the names electron-builder reads, each value
  taken as written and each path absolute:

  ```sh
  CSC_NAME="<name> (<team id>)"
  APPLE_API_KEY=/<path to the repo>/.release/AuthKey_<the key's id>.p8
  APPLE_API_KEY_ID=<the key's id>
  APPLE_API_ISSUER=<the App Store Connect key's issuer id>
  ```

  `CSC_NAME` is the Developer ID Application identity without its
  `Developer ID Application: ` prefix, which electron-builder adds. A pack
  missing any of them is no release, and fails (§ 2).

- **GitHub**: `gh auth status` has push rights on the repo.
- **Production's database**: the root `.env.production.local` holds the
  production Postgres's `POSTGRES_URL_NON_POOLING`, from the Vercel project's
  Supabase integration, which `pnpm db:push-remote` reads (§ 3).

## Once per product: the update feed

An installed app takes its updates from the repo's latest GitHub release,
through electron-updater: `latest-mac.yml` names the zip and its sha512, and
the app checks the zip's signature against its own Developer ID before it
installs. There is no key of ours to make or keep: the Developer ID is the
update key, so its certificate's export is what to back up.

## Once per product: the extension's store item

The committed extension key (`EXTENSION_PUBLIC_KEY` in
`packages/contract/src/extension/extension-identity.ts`) is one this repo
generated and threw the private half of away, so the dev build and the unpacked
store build have a stable id before any listing. The Web Store signs the real
item with a key of its own, and the id the site's Save link and § 5 name must be
that item's. Once:

1. A Chrome Web Store developer account (the one-time registration fee) on the
   owner's Google account.
2. `pnpm package:extension`, then upload
   `apps/extension/.output/inteligir-extension-<version>.zip` as a new item and
   save it as a draft, unpublished.
3. In the draft's Package tab, View public key: paste the key's base64 body
   into `EXTENSION_PUBLIC_KEY`. `pnpm --filter @repo/contract test` then fails
   naming the id Chrome derives from it; set `EXTENSION_ID` to that, which is
   the draft's id on its dashboard too.
4. Commit both. Every later upload is § 6's.

## Once per product: the phone's TestFlight

The phone ships through EAS Build to TestFlight, iPhone only. The credentials
(the distribution certificate, the provisioning profile, the App Store Connect
API key) live on EAS, never in this repo, and build numbers are EAS's
(`appVersionSource: remote`), so no commit bumps one; `eas.json` names no
`.easignore`, so EAS falls back to `.gitignore`, which keeps `.release/` and
every `.env*` out of the upload. Once:

1. `pnpm --filter @repo/mobile exec eas login`, then
   `pnpm --filter @repo/mobile exec eas init`. EAS cannot write a dynamic
   config, so commit the owner and project id it prints into `easProject` in
   `apps/mobile/app.config.js`; that one value also points EAS Update at the
   project.
2. The first `pnpm testflight:mobile` logs into the Apple team that signs the
   Mac app and lets EAS create and keep the certificate, the profile and an App
   Store Connect API key. Its submit creates the App Store Connect record for
   `com.inteligir.mobile`; commit that record's id as
   `submit.production.ios.ascAppId` in `apps/mobile/eas.json`.
3. In App Store Connect › TestFlight, create the internal group `Owner` with
   yourself in it, and the external group `Cohort`. Every build reaches `Owner`
   first, and `Cohort` only once it has passed there.
4. Fill TestFlight's Test Information: a beta description, a feedback email
   you read, `https://inteligir.com/privacy` as the privacy policy, and the
   Beta App Review sign-in: mint a production invite (`apps/web/README.md` §
   Invites), sign up with it at `https://inteligir.com/app/sign-up` with an
   address you read and a long password, and give the account a link, a note
   and a picture from `https://inteligir.com/library`. Keep the sign-in in
   `.release/`, and give the reviewer these notes:
   > Sign in with the account above; its items are already there. What the
   > phone last read opens offline; saving and the agent need a
   > connection. A link shared from another app while offline waits on the
   > phone until it is back online, and the page is then read in the cloud.

Passing: `pnpm --filter @repo/mobile exec eas config --platform ios` shows the
bundle identifier `com.inteligir.mobile`. If EAS's install fails under pnpm 12,
the fallback is a custom build, `.eas/build/production.yml`, that installs with
`pnpm install --frozen-lockfile --filter @repo/mobile...`.

## Once per product: the deployment's checks

Every push to main is a production deployment of the Vercel project
`inteligir`, and Vercel moves the production domains to it only once its
Deployment Checks pass: CI's `check` on the commit, and
`Vercel - inteligir: smoke`, the status `.github/workflows/smoke.yml` sets when
`pnpm smoke` passes against the deployment's own URL, before any domain points
at it. Once:

1. **The smoke account.** Mint a production invite (`apps/web/README.md` §
   Invites) and sign up with it at the production `/app/sign-up` with an
   address you read and a long random password, kept in `.release/`. It never
   holds anything: each run's file names no item, so housekeeping lets it go a
   day later.
2. **Secrets.** In the project's Settings › Deployment Protection, turn on
   Protection Bypass for Automation, then give the repo its secret and the
   account:
   `gh secret set VERCEL_AUTOMATION_BYPASS_SECRET`, `gh secret set SMOKE_EMAIL`,
   `gh secret set SMOKE_PASSWORD`. On CI a leg that cannot run fails, so a
   missing secret fails the check rather than passing it unsigned.
3. **The checks.** Settings › Git turns on repository dispatch events, which
   is how Vercel sends `vercel.deployment.ready` to start the Smoke run, and
   Settings › Environments › Production keeps automatic aliasing on. After a push whose Smoke run reported, Settings › Build and
   Deployment › Deployment Checks › Add Checks › GitHub requires `check` and
   `Vercel - inteligir: smoke`.

Passing: a pushed commit's production deployment waits, its checks pending,
until both pass, and only then do the production domains move to it; a run
with a wrong `SMOKE_PASSWORD` holds the next one, which Force Promote on its
page releases. Where the team's plan has no Deployment Checks, or they leave
`inteligir.vercel.app` unheld, the fallback is to watch each push's Smoke run
(`gh run list --workflow smoke.yml`) and run `vercel rollback` on a red one.

## 1. Version and changelog

On main, clean, at the commit to ship:

1. Set `version` in the root `package.json` to the release's `<version>`.
   The Mac app's About and its update feed read it, and the phone and the
   extension name it in every call.
2. Retitle `CHANGELOG.md`'s `## Unreleased` as `## <version> — <YYYY-MM-DD>`,
   and read the section once as a user would: it is the GitHub release's body,
   word for word.
3. When the `// WARNING:` line on `MIN_CLIENT_BUILD`'s default
   (`packages/service/src/env.ts`) says the next release owes the floor, set
   it to `<version>`, in the Vercel project's Production variable too if it
   sets one, and drop that line. Every checkout since the last release reports
   the last release's version, so a change that drops a `/v1` shape an older
   build reads cannot raise the floor past those checkouts: it writes that line
   instead.
4. Every release uploads the extension (§ 6), whether or not it changed: the
   floor names the product's version, so a store build left a release behind
   is refused the day the floor passes it.

## 2. Gates

```sh
pnpm format:fix && pnpm verify && pnpm smoke && pnpm package:desktop && pnpm package:extension
```

`package:desktop` is `electron-vite build`, then
`apps/desktop/scripts/package.ts` with `.release/release.env`: electron-builder
signs and notarizes the app, the script notarizes and staples the dmg, and the
release's assets land in `apps/desktop/.output/bin`. A pack is a release or it
fails: the script refuses to start without every `release.env` name, and to
finish without a stapled app and every asset § 6 uploads. Package only through
`pnpm package:desktop`: turbo's strict env mode strips every `APPLE_*` and
`CSC_*` exported in a shell, so a pack signs with `release.env` alone. A notarization
refused with a 403 saying "A required agreement is missing or has expired"
waits on the team's Account Holder accepting Apple's updated agreement at
developer.apple.com/account; pack again once it is accepted.

Commit as `release: <version>`, push, and wait for CI on that commit to go
green: `gh run list --commit "$(git rev-parse HEAD)"`.

## 3. The cloud first

1. **The schema.** From the release commit, `pnpm db:push-remote --explain`
   prints production's plan and changes nothing but `sql/extensions.sql`'s
   lines, each of which skips what is there. Read any drop or recreate in it
   (`packages/db/CLAUDE.md` § Postgres), then `pnpm db:push-remote`; a second
   `--explain` plans nothing. Every push to main deploys at once, so a commit
   that reads a new schema lands after this push, or its deployment fails
   smoke.

2. **The cloud.** The release commit's production deployment passed its checks
   and serves the domains (`gh run list --workflow smoke.yml` shows its Smoke
   run green), and it answers as itself:

   ```sh
   curl -s -X POST -H 'content-type: application/json' -H 'x-inteligir-build: <version>+mobile' \
     --data '{}' https://inteligir.com/v1/rpc/account/devices/list   # a 401 UNAUTHORIZED, never a 404
   curl -s https://inteligir.com/.well-known/oauth-authorization-server/api/auth   # "issuer":"https://inteligir.com/api/auth"
   ```

3. **The environment.** The project's Production variables name
   `BETTER_AUTH_SECRET`, `CRON_SECRET`, `EMAIL_MODE=resend` with
   `RESEND_API_KEY` and `EMAIL_FROM`, `BLOB_READ_WRITE_TOKEN` and the Supabase
   integration's `POSTGRES_URL` and `POSTGRES_URL_NON_POOLING`, and none of the
   keys `.env.example` keeps off Vercel (`AGENT_MOCK_MODEL`,
   `FILE_STORE_DIR`, `RATE_LIMIT_DISABLED`). The agent
   reaches AI Gateway by the project's OIDC token, so no gateway key is set. A
   variable changed takes effect at the next deployment.

## 4. The phone's internal build

1. **Pre-flight.** `docs/privacy.md` names every address the phone talks to,
   Expo's update check among them, and the release commit is green in CI.
2. **Build.** `pnpm testflight:mobile` from the release commit. Passing: App
   Store Connect's processing email carries no warning (a missing purpose
   string, an undeclared required-reason API); a warning is a fix and a new
   build, never a waiver.
3. **Internal.** Install the build from the `Owner` group on your iPhone, from
   TestFlight and never as a development build, for § 5's iPhone checks.
   Nothing reaches the `Cohort` group yet.

## 5. The owner's checks

One smoke list per surface, each check needing what no agent can run: a
device, signing, a store, a real model turn, the Vercel or Supabase
dashboard, or claude.ai and ChatGPT. Run them on the release's own artifacts:
the Mac app `pnpm package:desktop` left at
`apps/desktop/.output/bin/mac-arm64/Inteligir.app` (dragged to
`/Applications` and opened from Finder), the extension `pnpm package:extension`
left at `apps/extension/.output/chrome-mv3-store-unpacked`, and the iPhone build
from the `Owner` group. A failing check stops the release: fix it, and start
again at step 1.

### The cloud's resources

In the Vercel project `inteligir` and its Supabase project, against
production.

- **The database**: the Supabase project's disk sits well below 95% full, where
  Postgres turns read-only, and grows on its own; `item_body` and
  `item_search` show autovacuum running, since every note save writes its body
  and search row whole.
- **Files**: the project's Blob store, `inteligir-files`, is private and
  connected to Production, Preview and Development, each holding its
  `BLOB_READ_WRITE_TOKEN`; the store's contract passes given that key
  (`packages/service/README.md` § Testing); `pnpm smoke` with `SMOKE_URL`, a
  login and `VERCEL_AUTOMATION_BYPASS_SECRET` passes its file leg; a 100 MB
  file uploads and reads back a `bytes=0-9` range as 206, and a PDF dropped
  into `/library` draws in its frame; a `library.files.reserve`, a PUT of bytes
  hashing to another sha, then `settle` answers 400 and leaves nothing in the
  store.
- **The fill**: a link a connected assistant or the share sheet saves is read
  within a minute, `https://example.com` to Example Domain, its cover kept in
  Blob; a link whose name resolves to a private address says it is on a
  private network and isn't read.
- **Saves at size**: a 1 MB note saved 10 times, the deployment's logs show
  `/v1/rpc/library/items/saveBody` under 1 s at the 95th percentile.

### The Mac app

On the signed pack, against production, from a spare macOS user.

```sh
app=apps/desktop/.output/bin/mac-arm64/Inteligir.app
codesign --verify --deep --strict --verbose=2 "$app" && codesign -d --entitlements - "$app"
spctl --assess --type execute --verbose=4 "$app" && xcrun stapler validate "$app"
```

- **Signed .app from Finder**: codesign, spctl and stapler pass, it carries
  only electron-builder's JIT entitlements and bundles its notices, and it opens on macOS 13.5 and the
  newest macOS.
- **First run on a fresh macOS user**: the site's sign-in in the window, an
  invite sign-up, still signed in after Quit; a dev build keeps a store of its
  own; the Mac app shows in Settings › Account as This device.
- **Window**: the system title bar, close hides it, a link to another site
  and Settings › About's Licenses open in the browser, a ⌘-click on a sidebar
  folder opens it in the browser with the window left where it was, offline it
  says so, and View › Reload recovers.
- **Dictation**: fn fn in a note lands the words once.
- **Outline and find**: in a long note, a heading picked from the outline and a
  ⌘F match a screen away glide there, and one far off lands at once and stays.
- **Paste and drop** from Safari, Chrome, Arc and Finder: a link, a screenshot,
  a PDF and a file; over 100 MB refused; picture, PDF, mp4, mov and m4a items
  play in the window, and a recording in a note seeks before it has all loaded;
  Download lands in Downloads, from an item and from a file in a note.
- **Scale**: a 300-block article and a library of 20,000 to 50,000 items stay
  smooth; VoiceOver reads the grid and ⌘P.
- **Import** from Settings › Import: a real Obsidian vault's zip and a Raindrop
  CSV land, a 2 MB note in the zip is counted unreadable while the rest lands,
  and closing the window midway then choosing the zip again adds nothing twice.
- **Export** from Settings › Export: the zip lands in Downloads as
  `Inteligir library <date>.zip`, a library of several hundred MB exports with
  the window still answering, and Import a zip of notes… in a spare account
  brings back the same items, files opening in the window.

### The browser extension

The unpacked store build, against production, with no dev build loaded.

- **The store build** loads in Chrome, Arc, Brave and Edge with the id
  `EXTENSION_ID` (`packages/contract/src/extension/extension-identity.ts`), and
  the Web Store listing and the site's Save link open it.
- **Notices**: the store build's `licenses/` holds a notices file per group of
  entrypoints and the licence of each project vendored in what it bundles.
- **Sign in** through the welcome tab, which opens the site's sign-in; the
  browser shows in Settings › Account.
- **Save**: the toolbar saves, a second save says already saved, right-click
  saves a link and an image, the badge shows ! and ✓, and a home-network page
  the cloud can't reach saves as the extension read it.
- **A waiting save**: one made offline or across a browser restart lands later
  with no click, a page saved three times offline counts as 1 save waiting and
  lands as one item, and one made signed out lands as you sign in on the site.
- **A large picture**: right-click Save on a picture over 4.5 MB, on a slow
  link with DevTools closed, lands as its item.
- **A refused save**: one a full library refuses says so in the library's
  words and stays in the popup under Didn't reach your library, listed once
  however often its page is saved, where Try again lands it once there is room,
  or offline leaves it counted as waiting, and Let it go drops it.

### The iPhone app, on the internal build

- **The build**: the first `pnpm testflight:mobile` registers the App Group and
  the share extension, this build installs over the last, and an EAS update
  reaches the installed build.
- **Sign-in**: Sign in and Create an account; still signed in after a week, a
  lock and a restart (Keychain); Safari's sign-in stays Safari's; no iCloud
  backup growth; a restored backup on another phone signs in as itself.
- **The editor on real WebKit**: typing, autocorrect, the keyboard's mic, the
  `[[` picker, a 20,000-word paste, the Embed dialog covering the screen on
  iOS 26, and New note opening with the caret at its end and the keyboard up.
- **The editor's edges** on the oldest supported iPhone and on iOS 16.4: a cold
  open under a second, Inter and KaTeX faces, no zoom, the caret above the
  keyboard, Mermaid in dark mode.
- **A note saved whole**: type into a note, switch to another app at once,
  come back and see the text, then open the note on the Mac and see it there
  too; type again, switch away and remove the app from the app switcher, and
  the text is there when it opens again. A Mac edit shows within a few seconds
  while the note is open and not typed in, Back and the edge swipe leave a note
  not typed in at once, and Leave without saving asks over typing made in
  airplane mode.
- **The agent edits an open note**: with a note open on the phone, ask the
  agent on the Mac to add a line to it; the line shows on the phone within 15
  seconds, and a paragraph typed on the phone meanwhile is kept beside it.
- **A 1 MB note saves**: paste text in a few goes until the note is just under
  1 MB, type at its end and switch apps; the Mac shows the typing. Past 1 MB
  the note says it is longer than a note can be, and a single paste over half
  that is refused with why.
- **A save as the app goes behind**: on a physical iPhone, iOS 26, on cellular
  or with Network Link Conditioner on 3G, type into a 1 MiB note and switch apps
  within 1 s, 20 times; 18 or more saves must land, or take the fallback in
  issue 1041.
- **An offline launch**: items read-only, Needs a connection, and "1 save
  waiting", which lands once back online; one link shared twice offline is
  still 1 save waiting, and shared twice to a full library one refused row.
- **Shares** from Safari, YouTube, Mail, X and Notes (text, Japanese, a bit.ly
  link, `https://en.wikipedia.org/wiki/Oklahoma!`); a duplicate share opens the
  item; Page not read says why.
- **Photos** from the camera and the library at 1 MB or less with no GPS, a
  picture pasted in a note, and pictures, video and PDFs read across devices.
- **Covers**, which a row decodes from the kept file, on the oldest supported
  iPhone: a library whose first thirty rows have covers of 2 to 10 MB each
  (JPEG, PNG, WebP, HEIC and AVIF among them) launches cold and scrolls to its
  end and back without the app being killed; a 7000 x 7000 PNG, a 48-megapixel
  JPEG and a 48-megapixel HEIC draw on one screen at once, as does a JPEG no
  header reader sizes (one `0xFF` byte put in after its first two); a 30000 x
  30000 PNG, an AVIF or HEIC over 50 megapixels, a hostile `og:image` cover, a
  GIF and an SVG each show the placeholder, and each opens in its viewer or
  refuses with no crash; and every cover draws again on the next launch,
  offline.
- **The agent on the phone**: a reply drawn as it is written, a message sent
  mid-reply joining that turn, Stop, thinking shown, the phone locked for a
  minute mid-reply and unlocked picking up where it left off with no gap and
  nothing doubled, and an offline send and Stop each refused with Needs a
  connection.
- **A long conversation on the phone keeps to its end**: one longer than the
  screen opens on its last message, a streamed reply and its Working… line stay
  in view as they grow, the end stays above the keyboard as it comes up,
  scrolling up holds the reader's place while the reply goes on, and the next
  send, or scrolling back to the end, follows again.
- **Sign-out**: with a share waiting, a revoke in the foreground and the
  background, and mid-upload; the app's Library/Caches holds nothing after.

### The iPhone app, in the simulator or a development build

Nothing drives the phone headless; check these by hand.

- **A release build in the simulator**: the `+native-intent` share address, a
  killed WebContent process reloading, and every screen in light and dark.
- **Cover memory on a device**: a Release build on the oldest supported iPhone
  (`pnpm --filter @repo/mobile ios --configuration Release --device`), Xcode
  attached to it (Debug › Attach to Process) with its memory gauge open: the
  thirty-cover library and the three 48-megapixel covers of the internal
  build's Covers check, at a cold launch and through a scroll to the end and
  back, raise no memory warning and leave the gauge where it rested before the
  scroll.

### The site

- **A password reset** mailed on production signs every device out, and a
  reset or sign-up started from the consent page lands back there.
- **Notices**: on production, the home page's Licenses and Settings › About's
  open `/licenses.md`, and each vendored text it links answers.
- **Share cards** for /about and /privacy in a chat app; `apps/web/public/og.jpg`
  and the store listing's pitch are current.
- **The two policies on Vercel**, which serves a route rendered per request from
  its shell before any of the app runs: signed in, every `<script>` of
  `curl -s <deployment>/library` carries the nonce its `content-security-policy`
  names, or is the theme script its hash names; `curl -sI <deployment>/` shows
  `script-src 'self' 'unsafe-inline'`, and `curl -sI <deployment>/v1/blobs/<sha>`
  only the file's own policy.
- **The crons on Vercel**: the project's Cron Jobs tab lists `/api/cron/jobs`
  every minute, `/api/cron/housekeeping` hourly and `/api/cron/agent` every 15
  minutes, each run answering 200 in the logs; a file in Deleted emptied a day
  ago is gone from the Blob store.

### The library in a browser tab

- **The production deploy**: `/library` with no policy error, a `?item=` deep
  link, its assets and a 404, and a write on another device showing within
  20 s.
- **A video item** plays and seeks before it has all loaded, in Safari on a Mac
  and on an iPhone.
- **A PDF item**, in Chrome and Safari: its viewer shows the name it was added
  with, and its download saves it under that name.
- **A file of nearly 100 MB**, dropped on the grid and pasted into a note, in
  Chrome, Safari and the Mac app: the window keeps scrolling and taking typing
  until its upload starts.
- **Export** in Chrome: Settings › Export asks where to save, writes the zip
  there, which opens in Finder; Stop midway leaves no finished zip; in Safari and
  Firefox the zip lands in Downloads.
- **Safari, Chrome and Firefox**: a note saving a second after typing stops, the
  offline notice, the leave prompt over typing that couldn't save on Back and on
  closing the tab, Settings opened,
  closed, and opened again by Back over a grid still where it was, popups
  fading, the highlight gliding from row to row in the rail and in a menu, ⌘P,
  VoiceOver, a Docs or Word list paste, Info's Add property picking a date and
  refusing an empty number, a dark window's note printing light, and a tab left
  open keeping its sign-in.
- **A save as the window goes**: on an unlocked Mac, type into a note, then
  switch apps, minimize the window, and close it, in Chrome, Safari and the Mac
  app, and check that each save lands.
- **A sweep against the cloud's database**: ⌘A then Delete over a scope of a
  few thousand items empties the grid within seconds while another tab still
  reads, and ⌘A then Tag over more than 1,000 tags them all within a minute.
- **Safari on an iPhone with iOS 26**: a dialog's backdrop covers the screen,
  Page not read opens its popover on a tap, and the header fits a phone.

### The connector

On production's `/connector`, signed in to an account there.

- **claude.ai**: add the custom connector, sign in and Allow on
  `/connect/authorize`, read, edit, Disconnect in Settings and the next call
  asks to connect again; a sign-in from the authorize step returns to it.
- **Claude Code**: `claude mcp add`, the consent page's warning that access goes
  to an app on this computer, 10 tools, and `read_item` and `read_guide`
  answering inline; still connected after an hour, on its refresh token.
- **ChatGPT**: a developer-mode connector, Only let it read the library, and
  the five reading tools alone.
- **A reconnect**: an assistant connected before a change to the connector's
  sign-in (its issuer, its tokens' store) asks to connect again once, reads and
  edits after Allow, and shows once under Connected assistants.

### The built-in agent

Production reaches Sonnet 5.5 through the team's AI Gateway. An account has
two turns a UTC day, and the dollar ceilings are constants beside them
(`packages/service/src/agent/agent-limits.ts`).

- **The gateway**: it runs Anthropic on the team's own key, from an Anthropic
  workspace of its own with a spend cap; the deployment reaches it by the
  project's OIDC token, and Vercel Workflow runs eve's sessions.
- **A real turn**, open in a tab and the Mac at once: events
  stream, the conversation follows the reply to its end and the reply does not
  blink as it lands, one change set, Undo keeps a note you typed in since, the allowance
  counts, and cache reads show.
- **Budgets**: a deploy mid-turn costs one call, a turn stops at 20 steps, and
  an account's 50 cents or every account's $5 a day, priced from the tokens in
  `agent_usage`, ends it `budget`; the day's spend there matches the Anthropic
  console's within a call.
- **Real-model behaviour**: a search cites its pages and a page read answers
  from it; Tidy my library follows the rules; the agent writes the dialect.
- **Across deploys**: a prompt change between two turns is taken up, and a long
  conversation compacts and goes on after a pause and a deploy.
- **A hostile page**: asked to read a page whose text tells the agent to fetch
  another address carrying the library's words, every search and fetch the
  turn made shows among its calls; a link it saved is read at once, and Undo
  this turn still takes it back.

## 6. Publish

Only once every check in § 5 has passed, and the three close together.

1. **The Mac app.** Tag and publish. The site's Download button links
   `releases/latest/download/Inteligir-arm64.dmg`, so the release must carry
   the dmg under that fixed name (`DMG_NAME` in
   `apps/desktop/scripts/package.ts`), and every installed app reads
   `latest-mac.yml` and the zip it names. The notes are
   the changelog's top section, which `apps/desktop/scripts/release-notes.ts`
   prints only once it is titled for this version, so a refusal stops the
   chain before the tag:

   ```sh
   node apps/desktop/scripts/release-notes.ts > .release/notes.md &&
     git tag v<version> && git push origin v<version> &&
     gh release create v<version> --notes-file .release/notes.md \
       apps/desktop/.output/bin/Inteligir-arm64.dmg \
       apps/desktop/.output/bin/Inteligir-arm64.zip \
       apps/desktop/.output/bin/Inteligir-arm64.zip.blockmap \
       apps/desktop/.output/bin/latest-mac.yml
   ```

   A release missing `latest-mac.yml` or the zip is one no installed app can
   update to, and one missing `Inteligir-arm64.dmg` leaves the Download button
   a 404.

2. **The phone's cohort.** Add the build to the `Cohort` group with its What
   to Test, in the words a tester reads:

   > Sign in with your Inteligir account's email and password. Your library
   > arrives, and what you last read opens offline. Save a link from the share
   > sheet, write a note on your Mac and read it here, and add a photo. Take a
   > screenshot to send us feedback.

   A version's first build for the group waits for Beta App Review, usually a
   day. Then invite testers, by email or one public link; each needs an
   account first, which takes an invite code (`apps/web/README.md` § Invites).
   A build expires 90 days after upload, so a cohort still testing then needs
   a new build of the same version (Hotfixes, below).

3. **The extension.** Upload
   `apps/extension/.output/inteligir-extension-<version>.zip` to the store
   item, and keep the listing true to what it does: the description, the
   screenshots, the single-purpose statement ("saves the page you are on to
   your Inteligir library"), a justification for each permission (`activeTab`
   and `scripting` to read the page only when you click, `contextMenus` for the
   right-click Save, `cookies` and the `https://inteligir.com/*` host to read
   your inteligir.com sign-in, so the extension saves as you with no sign-in of
   its own and sends a save made signed out as you sign in, `storage` to keep
   which account it saves to and a save made offline or signed out, `alarms` to
   send a save made offline once you're back online), the privacy practices
   (website content and authentication information, sent to the person's own
   Inteligir library, never sold or transferred) and the policy URL
   `https://inteligir.com/privacy`. Submit for review; § 7 installs what the
   store approves.

## 7. After

- **The download.** Passing: the site's Download button downloads this
  version's `Inteligir-arm64.dmg`, and the app from it opens from Finder with
  no warning beyond macOS's downloaded-from-the-internet notice.
- **The update.** It starts from the previous release reading the
  `latest-mac.yml` § 6 published, so it runs only here. On a Mac running the previous release,
  open the app, or choose Check for updates in Settings › About. Passing: the
  update's toast offers `<version>` (VoiceOver reads it), Download fills its
  bar, Settings › About says `Inteligir <version> installs when it restarts.`,
  and Restart to update relaunches the app; About Inteligir names `<version>`,
  with the library as it was. Again from the previous build, type in a note and choose Restart to
  update at once. Passing: the words just typed are still in the note. Again from the previous
  build, choose Download and turn Wi-Fi off before the bar fills. Passing: the toast says the
  download didn't go through, with the reason, and Settings › About says
  `Inteligir <version> didn't download.`; Try again while still offline keeps the toast up with
  its reason and never shows the bar, and Try again once Wi-Fi is back fills the bar with no new
  check.
- **The extension.** Once the store approves this upload, install it from
  `chromewebstore.google.com/detail/<EXTENSION_ID>` in a browser with no dev
  build loaded. Passing: the install prompt names inteligir.com as the one
  site it can read and change, chrome://extensions shows `EXTENSION_ID`, and,
  signed in to inteligir.com in that browser, the toolbar button saves the page
  into the library with no other step.
- **The cohort.** Passing: the phone build is approved in the `Cohort` group,
  and one tester installs it from the invite and signs in.
- **This file.** Whatever the release needed that is not written here goes in
  now, where the next release will meet it.

## Hotfixes

- **The phone, JavaScript alone**: an EAS Update to the `production` channel,
  never a new build. Branch from the tag of the build TestFlight serves, apply
  the fix, and run `pnpm --filter @repo/mobile hotfix` there; the script clears
  `EXPO_PUBLIC_CLOUD_URL`, since `eas update` bundles with this shell's
  environment. An update reaches only builds whose fingerprint matches, and the
  fingerprint covers the app config, `version` included, so one bundled after
  a version bump reaches nobody;
  `pnpm --filter @repo/mobile exec eas fingerprint:compare --build-id <id>`
  names what differs. The editor's DOM bundle rides the JavaScript, so its
  fixes are updates too. Passing: as the update check in § 5. A bad update is
  rolled back with `pnpm --filter @repo/mobile exec eas update:rollback <group id>`.
- **The phone, anything native** (a module, a config plugin, the SDK): a new
  build of the same version, `pnpm testflight:mobile` from a branch off the
  tag, then § 4 from step 3. `pnpm --filter @repo/mobile exec eas
  build:version:get --platform ios` prints the latest build number.
- **The Mac app or the extension**: a patch version through this whole runbook. The
  version is all three's, but the phone's build may stay behind; its
  JavaScript hotfixes then branch from the tag of the build TestFlight serves.
