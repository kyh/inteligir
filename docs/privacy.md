# Privacy Policy

Effective as of November 6, 2026.

To view previous versions of this Privacy Policy, see its [history on
GitHub](https://github.com/kyh/inteligir/commits/main/docs/privacy.md).

**California Notice at Collection/State Privacy Rights Notice**: See the [State
privacy rights notice](#state-privacy-rights-notice) section below for important
information about your rights under applicable state privacy laws.

Kaiyu Hsu ("**Inteligir**," "**we**," "**us**" or "**our**") provides Inteligir,
a library of everything you save and write, kept in your account in our cloud
and shown by a Mac app, an iPhone app, a browser tab and a browser extension,
with a built-in AI agent that files and edits it with you. This Privacy Policy
describes how Inteligir processes personal information that we collect through
our digital or online properties or services that link to this Privacy Policy
(including, as applicable, our website at inteligir.com, our Mac app, our iPhone
app and our browser extension) and the other activities described in this
Privacy Policy (collectively, the "**Service**").

**Notice to European users**: Please see the [Notice to European
users](#notice-to-european-users) section below for additional information for
individuals located in the European Economic Area or United Kingdom (which we
refer to as "**Europe**", and "**European**" should be understood accordingly).

**Index**

- [Personal information we collect](#personal-information-we-collect)
- [Tracking & Other Technologies](#tracking--other-technologies)
- [How we use your personal information](#how-we-use-your-personal-information)
- [Retention](#retention)
- [How we share your personal
  information](#how-we-share-your-personal-information)
- [Your choices](#your-choices)
- [Other sites and services](#other-sites-and-services)
- [Security](#security)
- [International data transfer](#international-data-transfer)
- [Children](#children)
- [Changes to this Privacy Policy](#changes-to-this-privacy-policy)
- [How to contact us](#how-to-contact-us)
- [State privacy rights notice](#state-privacy-rights-notice)
- [Notice to European users](#notice-to-european-users)
- [Every address the app talks to](#every-address-the-app-talks-to)

## Personal information we collect

Your library, the notes you write and the links, pages and files you save, is
your account's, kept by our cloud: the part of the Service we run on
Cloudflare, at inteligir.com. An account is required. Each device you sign in
on keeps a copy of your library, reads it with no connection, and sends what
you change to our cloud when it has one; our cloud tells each of your devices
when another has changed it. This Privacy Policy states exactly what that
means: what each device sends and where, what it keeps, how long our cloud
keeps it, and how it is deleted.

Your conversations with the built-in agent are your account's too: our cloud
keeps each one with your library, so every device you sign in on shows it. What
the agent reads to answer you goes to Anthropic, which runs the model for us
(see [How we share your personal
information](#how-we-share-your-personal-information)).

**Information you provide to us.** Personal information you may provide to us
through the Service or otherwise includes:

- **Contact data**, such as your name and email address, which you give us when
  you create an account or write to us.
- **Profile data**, such as the email address and password you set to establish
  an account on the Service, the invite code you redeemed, and the devices you
  sign in. Specifically:
  - **Account data** — your name, email, a hash of your password and your
    sessions (each with the IP address and user agent it signed in from), kept
    in Cloudflare D1 (Better Auth, the sign-in software our cloud runs), and the
    invite code you redeemed with your email beside it. You create the account
    in the app, or on our website: your name, email, password and invite code
    cross the wire over HTTPS once, and, from the app, the same request signs
    that Mac in. A password reset emails you a link through Cloudflare's own
    email sending, and the link's token waits in D1 (see
    [Retention](#retention)).
  - **Device records** — a name per device (the name Finder shows for a Mac, the
    name a phone reports for itself, or one you type when you sign the device
    in), timestamps (created, last seen, revoked) and the SHA-256 hash of each
    device credential. The credential itself is answered once, when the device
    signs in with your email and password or creates the account, and never
    stored. The password crosses the wire for that one request and is held
    nowhere on the device; the browser session that sign-in or sign-up would
    have created is deleted in the same request, so the device holds its
    credential and nothing else.
- **Communications data** based on our exchanges with you, including when you
  contact us by email, open an issue on GitHub, or send us feedback through
  Apple's TestFlight while you test the iPhone app.
- **User-generated content and input data**, such as your notes, attachments,
  saved links, their text and covers, what you ask the agent and other content or
  information that you generate, transmit, or otherwise make available on the
  Service, as well as associated metadata. Metadata includes information on how,
  when, where and by whom a piece of content was collected and how that content
  has been formatted or edited. Metadata also includes information that users
  can add or can have added to their content, such as keywords, geographical or
  location information, and other similar data. Once you sign in, our cloud
  receives:
  - **Your library, in your account.** Every change a device of yours makes —
    to items, files, folders and tags — goes to your account's
    library in our cloud, which keeps what each change replaced for seven days,
    so Undo can take it back, each change named for the device or the assistant
    that made it and the built-in agent's for the conversation that made them.
    Your library is reachable only with a credential from your own account, and
    holds about 1 GB, what Undo keeps included. A
    full one still opens and downloads everywhere, but takes no new changes:
    the device that made one says so, and the change is not in your library
    until you send it again once there is room. A file over 100 MB is never
    kept. It is encrypted at rest by Cloudflare, but we can read it — there is no
    end-to-end encryption.
- **Other data** not specifically listed here, which we will use as described in
  this Privacy Policy or as otherwise disclosed at the time of collection.

**Third-party sources.** We may combine personal information we receive from you
with personal information falling within one of the categories identified above
that we obtain from other sources, such as:

- **Service providers** that provide services on our behalf or help us operate
  the Service or our business, such as Apple, which, when you test the iPhone
  app through TestFlight, shares with us under its own terms the crash reports,
  feedback and screenshots you choose to send.

**Automatic data collection.** We and our service providers may automatically
log information about you, your computer or mobile device, and your interaction
over time with the Service, our communications and other online services, such
as:

- **Device data**, such as your IP address and your browser's user agent.
  Specifically:
  - **The sessions on our website** each keep the IP address and user agent they
    signed in from (see Account data, above).
  - **Your IP address, for throttling — the one row NOT tied to your account.**
    Signing a device in, creating an account, redeeming an invite, an assistant
    registering itself to connect, and every Better Auth route but the session
    read count attempts per caller address in D1's `rate_limit` table: a row
    holds the address, an IPv6 address cut to its first 64 bits, beside the
    route it counts, a count and a timestamp.
    Before sign-in the address is all our cloud knows about a caller, and a
    login with no throttle is a password oracle. Once signed in, a device's
    reads and writes of your library, and its attempts to delete the
    account, are counted the same way under the device's id, never an address,
    a browser tab's under its session's id, and a connected assistant's calls
    under the id of the access you gave it.
  - **The app's version, on every request to our cloud.** The Mac app, the
    phone app and the browser extension say which version they are, and which
    of the three, on each request they send our cloud, so it can stop answering a version too old to sync with
    it rather than answer it wrongly. Our cloud reads it to decide whether to
    answer, and keeps no record of it.
  - **The update check — to GitHub.** The packaged desktop app asks GitHub's
    release feed whether a newer version exists 15 seconds after launch and
    every 4 minutes after that, downloads a newer one from GitHub in the
    background and installs it when you quit the app (or at once, with Restart
    to Update). GitHub sees your IP address, nothing about your library or your
    account.
  - **The phone's update check — to Expo.** Each time the phone app starts it
    asks Expo's update service whether a newer version of its app code exists,
    downloads one in the background and runs it from the next start. Expo sees
    your IP address, the app's build and a random id the app keeps for that
    install, nothing about your library or your account.
- **Online activity data**, limited to **a log of each request, kept by
  Cloudflare.** Cloudflare, which runs our cloud, logs each request our cloud
  answers, the pages of our website included — the address asked for, less
  anything after a `?` in it, the answer's status and the time — and keeps that
  log for up to seven days, for us to diagnose failures with; about one request
  in a hundred is traced in more detail. An address never holds a file's name
  or anything you wrote: the apps' calls carry those in the request's body, a
  file's address holds a fingerprint of its contents, which identifies that
  exact file. Our cloud's own error lines give
  that address, or the name of what failed, with the opening of the error's
  message, which can quote what it was given.

For more information concerning our automatic collection of data, please see the
[Tracking & Other Technologies](#tracking--other-technologies) section below.

**Data about others.** Content you sync, such as your library, may hold
personal information about other people,
and our cloud holds what you sync. Please do not share someone else's personal
information with us through the Service unless you have their permission to do
so.

## Tracking & Other Technologies

**Cookies and other technologies.** Some of our automatic data collection is
facilitated by cookies and other technologies. The Service uses only these:

- **Essential.** Our website sets a first-party cookie, Better Auth's session
  cookie, when you sign in or create an account there, so that its account pages
  (the list of your devices, for one) know it is you. It keeps you signed in to
  those pages for seven days, renewed as you use them. When an assistant you are
  connecting sends you to our consent page, the page sets one more, for at most
  ten minutes and cleared once you answer, that ties your answer to the browser
  you were asked in. Your library in a browser tab, at inteligir.com/library,
  is signed in by that same session cookie. The Mac app and the iPhone app use
  no cookies.
- **Functionality / performance.** Our website keeps your choice of light or
  dark theme in your browser's web storage (local storage), first-party, and
  never sends it to us; your library in a browser tab keeps its settings and
  layout there too, and the apps keep theirs on your device. The tab and the Mac
  app keep your account's id beside them, so that what one account was viewing
  never opens for the next.
- **Analytics, advertising and social media.** We do not use analytics,
  advertising or social media cookies, or any similar technology, on our website
  or in the apps.

The apps also hold to these, plainly:

- **Telemetry.** The apps and the extension send none, about your library or
  anything else.
- **Anything an item points at on the web.** Opening an item loads nothing from
  the web, on the Mac, the phone or in a browser tab: an image or embed at a
  web address is not fetched, so nobody learns you opened it. A link opens in your browser only
  when you follow it.
- **Saving a link — from our cloud, to that site.** A link that reaches your
  library without its page (one you pasted or saved on the Mac, in a browser
  tab or on the phone, one an assistant you connected saved, one the built-in
  agent saved once you allowed it, seeing the whole address, one imported, one
  refreshed, one the browser extension sent as its address) is fetched once by
  our cloud, from Cloudflare's network, to fill in
  its title, site, description, cover image and readable text. It also fetches
  the cover image the page names. For YouTube, Vimeo, X, TikTok, Spotify and
  SoundCloud it asks that site's own oEmbed address (with X's `dnt=true`), for
  any other page the oEmbed address the page itself names, and the picture
  that answer names; for a YouTube video it may also fetch the video's still
  picture from YouTube; for a link imported from Raindrop, the cover picture
  Raindrop recorded for it. The request carries no cookies, sign-in or
  referrer, and names inteligir in a Safari-compatible user agent and English
  as its language; the site sees Cloudflare's address, never yours. Our cloud
  reads only web addresses on their own ports, and never one whose name or
  written-out address points into a private network, or into space no site
  holds, whether you saved it or a page redirected there. The page's text and
  its pictures land in your library; the page itself is not kept.
- **The browser extension.** The Inteligir extension for Chrome, Arc, Brave,
  Edge and Vivaldi reads the page you are on only when you click Save or choose Save from
  the right-click menu. It reads the page as it is shown (its address, its
  title and its HTML without its scripts) in your browser, and sends what it
  read, the page's text, the facts it gives about itself and its cover picture,
  to your Inteligir library in our cloud, signed in with a key of its own that
  inteligir.com/connect/extension gave it, which you can revoke from your
  devices. It fetches the cover picture the page names, from your browser and
  without your cookies, and nothing else. Nothing you typed into the page goes
  with it: form fields, the choices a page filled in for you and every box you
  type into, such as an email you are writing, are emptied first. Some saves
  send only an address, which our cloud then fetches and reads as it does any
  link your library holds unread (above): a link or a picture you save
  from the right-click menu, and a page the extension cannot read in your
  browser (the Web Store, a PDF, a page too large to read there or to send, or
  one it found no text in), which goes with its title. A page with no web
  address, such as the browser's own pages, is
  never saved: the extension says it can't save it and sends nothing. A picture
  a page drew itself, which has no address, is uploaded to your library as a
  file of its own. A save made while you are offline waits in the browser's
  storage for the extension as the page's address and title, and is sent, for our cloud to read, once you are back online.
- **Sharing from your iPhone.** Sharing a page or a link to Inteligir saves
  its address, with the title the sharing app gave it and the words you shared
  beside it, into your library, like any other edit on the phone; the phone
  fetches nothing from the site. Our cloud then fetches and reads the page as
  it does any link your library holds unread (above), so a page only your own
  network reaches is not read. A link inside text you share is saved the same
  way, the words around it its note, and other text is saved as you shared it.
- **Importing.** The file you choose to import (a Raindrop CSV, or a zip of
  notes such as an Obsidian folder) is uploaded to your library, read there and
  deleted once the import ends. Each imported link is then filled in as above.
- **Your voice.** Neither the Mac app nor the phone app ever opens the
  microphone. Dictation is your operating system's own — on a Mac, press fn
  twice; on the phone, the keyboard's microphone key — which types into the app
  like a keyboard; where that audio goes is Apple's to say, under its own
  settings and terms.
- **Where a phone photo was taken.** The phone opens the camera only when you
  take a photo to add to your library, and from your photo library it receives
  only the photo you pick. It keeps a copy at most 2048 pixels on its long
  side, saved again as a JPEG, or a PNG if it was one, without its location or
  any other camera details and named for when you added it; only that copy
  reaches your library. A picture you paste into a note's text is not saved
  again: it reaches your library as the file you pasted, with whatever details
  it carries.
- **The Mac's copy of your library, and its sign-in.** The Mac app keeps a
  copy of your library, and the files you open from it, in its own
  folders on that Mac, so it reads them with no connection; signing out deletes
  them. The device's sign-in is kept in the macOS Keychain and nowhere else on
  disk. The app keeps no log.

**Chat and other artificial intelligence ("AI") technologies**, such as
Anthropic's Claude, which our cloud runs to operate the built-in agent you can
ask to read, file, draft and edit your library through the Service, and the
assistant you connect yourself, such as Claude or ChatGPT. Specifically:

- **What the built-in agent reads — to Anthropic, on our account.** The
  built-in agent runs in our cloud, on our account with Anthropic, not yours:
  no device of yours talks to Anthropic, and you sign nothing in. What you ask
  it, the items you were looking at or selected, and what it reads of your
  library to answer go to Anthropic through Cloudflare's AI Gateway, as
  described in [How we share your personal
  information](#how-we-share-your-personal-information).
- **What an assistant you connect reads — to that assistant's provider.** An
  assistant you connect on our consent page reads and changes your library
  through our cloud, and what it reads goes to its provider under the
  provider's own terms with you, as part of your conversation there.

For information concerning your choices with respect to the use of tracking
technologies, see the [Your choices](#your-choices) section below.

## How we use your personal information

We may use your personal information for the following purposes or as otherwise
described at the time of collection:

**Service delivery and operations.** We may use your personal information to:

- provide the Service;
- enable security features of the Service;
- establish and maintain your user profile on the Service;
- communicate with you about the Service, including by sending Service-related
  announcements, updates, security alerts, and support and administrative
  messages; and
- provide support for the Service, and respond to your requests, questions and
  feedback.

**Service personalization**, which may include using your personal information
to remember your selections and preferences as you navigate webpages.

**Compliance and protection.** We may use your personal information to:

- comply with applicable laws, lawful requests, and legal process, such as to
  respond to subpoenas, investigations or requests from government authorities;
- protect our, your or others' rights, privacy, safety or property (including by
  making and defending legal claims);
- audit our internal processes for compliance with legal and contractual
  requirements or our internal policies;
- enforce the terms and conditions that govern the Service; and
- prevent, identify, investigate and deter fraudulent, harmful, unauthorized,
  unethical or illegal activity, including cyberattacks and identity theft.

**Data sharing in the context of corporate events.** We may share certain
personal information in the context of actual or prospective corporate events.
For more information, see [How we share your personal
information](#how-we-share-your-personal-information), below.

**To create aggregated, de-identified and/or anonymized data.** We may create
aggregated, de-identified and/or anonymized data from your personal information
and other individuals whose personal information we collect. We make personal
information into de-identified and/or anonymized data by removing information
that makes the data identifiable to you and we will not attempt to reidentify
any such data. We may use this aggregated, de-identified and/or anonymized data
and share it with third parties for our lawful business purposes, including
analyzing and improving the Service and promoting our business.

**Further uses.** In some cases, we may use your personal information for
further uses, in which case we will ask for your consent to use your personal
information for those further purposes if they are not compatible with the
initial purpose for which information was collected.

## Retention

We generally retain personal information to fulfill the purposes for which we
collected it, including for the purposes of satisfying any legal, accounting, or
reporting requirements, establishing or defending legal claims, or for fraud
prevention purposes. To determine the appropriate retention period for personal
information, we may consider factors such as the amount, nature, and sensitivity
of the personal information, the potential risk of harm from unauthorized use or
disclosure of your personal information, the purposes for which we process your
personal information and whether we can achieve those purposes through other
means, and the applicable legal requirements.

When we no longer require the personal information we have collected about you,
we may either delete it, anonymize it, or isolate it from further processing.

Specifically, in our cloud:

- Your library keeps each change, with what it replaced, for seven days after
  it is finished, so Undo can take it back, and deletes it within about a day
  after that. An item stays until it is deleted for good or the account is
  deleted. Deleting an item moves it to Deleted; emptying Deleted, or Delete
  forever, removes the item's text and what Undo kept of it at once,
  and each of its files once no other item and nothing Undo can still bring back
  names it.
- Device rows (including revoked ones) persist as the dashboard's audit trail
  until account deletion. A device's throttling counters are deleted when it is
  revoked.
- A row for each assistant you disconnected (its grant's id and your account)
  persists until account deletion, so an assistant renewing its access at that
  moment stays out.
- Throttling rows keyed on an address, a browser session or an assistant's
  access, not an account, cannot be found by account deletion, and neither a
  session ending nor an assistant's removal deletes its own. Better Auth deletes
  every row whose timestamp is over a minute old whenever one of its own limits
  opens a fresh window, so a row outlives its minute only until the next such
  request from anyone; nothing sweeps the table on a timer.
- A password-reset link's row (its token and your account's id) is deleted when
  the link is used. One never used stops working after an hour and is swept the
  next time anyone opens a reset link; account deletion does not look for it,
  and once the account is gone it opens nothing.
- An assistant you connected keeps its grant until you Disconnect it in
  Settings › Account › Connected assistants, which ends its access at once, or
  until 30 days after it last renewed its access, which it does while it keeps
  using it: removing the connector in the assistant stops its requests, and the
  grant then lapses at those 30 days, unless it keeps renewing. Deleting the
  account revokes every assistant's grant, which our cloud stops answering
  everywhere within about a minute. What an assistant
  registered (its name and addresses, never yours) is deleted 90 days after it
  last used it, and deleting the account leaves a registration to those 90
  days, since none is filed under an account.
- A conversation with the built-in agent, the record of it in its own storage
  and its messages in your library alike, is kept until you delete it
  or your account, and deleting it deletes both.
- Cloudflare's request log keeps each entry for up to seven days.

**Your phone.** Signed in, the phone keeps its own copy, so it opens and edits
your library offline:

- **Every item**, its text and folders, downloaded from your
  library, a small picture for each card, and a picture, PDF or other
  file once you open it.
- **Whatever it has not sent yet.** Edits, saves, new notes, deletions and
  photos wait on the phone until your library takes them.
  A change the library refuses stays on the phone and says so. A page you
  share to Inteligir waits in the share sheet's own storage on the phone until
  the app saves it.

It all lives in the app's own storage on the phone. The items and unsent
changes, photos waiting to be sent and the files your notes embed included,
sit where the app keeps them out of the phone's iCloud backup: a phone
restored from a backup downloads your library again, and anything it had not
sent is gone. Other files you opened sit in the app's cache, which iOS may
clear and never backs up. The phone's sign-in is kept in the iPhone's Keychain
for that iPhone alone: a backup restored onto another phone does not carry it,
so the new phone signs in again and becomes a device of its own.

- **Signing out** on the phone erases all of it — items, files and anything
  unsent, which it asks about first — and
  tells our cloud to remove the phone from your account. A phone that signs out
  offline forgets its sign-in all the same; revoke it from Settings › Account on
  a Mac.
- **Revoking the phone** from a Mac, or **deleting the account**, erases the
  same the next time the phone reaches our cloud and is refused, without
  asking. Until then it keeps what it holds.

## How we share your personal information

We may share your personal information with the following parties (or as
otherwise described in this Privacy Policy, in other applicable notices, or at
the time of collection).

**Service providers.** Third parties that provide services on our behalf or help
us operate the Service or our business (such as hosting, information technology
and email delivery). Specifically:

- **Cloudflare** runs our cloud and our website. Its D1 database holds your
  account, sessions, devices, the invite you redeemed, a row for each assistant
  you disconnected and the throttling rows;
  its KV storage holds each assistant you connected: what it registered (its
  name and the addresses it gave), its grant, filed under your account with
  its name and what you let it do, and its tokens, kept only as hashes;
  your own Durable Objects hold your library, your devices' live connections
  and each conversation with the built-in agent; its R2 storage holds your
  files, under your account's own prefix; its Queues hold each
  link your library asked our cloud to read, as your account's id, the item's,
  its address and the address of any cover the save knew of, until our cloud
  has read it or recorded that it could not; its AI Gateway passes each request
  the built-in agent makes to Anthropic, and is asked to keep only its metadata
  (the model, how many tokens, its status and how long it took), never what it
  carries; its email sending delivers your
  password-reset emails; and it keeps the request log described above.
- **Anthropic** answers the built-in agent's questions for us, on our account,
  not yours. What you ask it, what you were looking at, and everything it
  reads of your library to answer you (items, their text, folders and tags) go
  to Anthropic as each request it makes, through
  Cloudflare's AI Gateway, under Anthropic's terms with us. When a
  conversation grows long, Anthropic's API also writes a summary of its
  earlier part inside the request that reaches that length, and hands it back
  with the answer; our cloud keeps it with the rest of the conversation and
  sends it in place of what it summarizes. Anthropic's API keeps none of those
  requests, summaries or answers once it has answered, past the parts it
  caches for at most an hour to answer the next request of the same
  conversation sooner. The conversation itself is kept by our cloud
  alone: deleting it deletes it, and deleting the account deletes every
  conversation before your library goes, with nothing to delete at
  Anthropic.
- **GitHub** hosts the Mac app's releases and its update feed, and the issues
  you open there.
- **Expo** answers the iPhone app's update check.
- **Apple** delivers the iPhone app through TestFlight.
- **The email services** that receive and forward the email you send us.

**Third parties designated by you.** We may share your personal information with
third parties where you have instructed us or provided your consent to do so.
It travels from our cloud:

- **Your library, to an assistant you connect.** When you allow Claude,
  ChatGPT or another assistant on our consent page, our cloud answers its
  requests from your library: what it searches for and reads (items,
  their text, folders and tags) goes to that assistant's provider
  under the provider's own terms, as part of your conversation there. What it
  writes lands in your library as a change named for it, which you can ask it
  to change back, and one you allowed only to read can change nothing. The page
  names the assistant as it named itself and where its access is sent.
  Disconnecting it in Settings › Account › Connected assistants ends its access
  at once. Removing the connector in your assistant stops its requests, and its
  access lapses 30 days after it last renewed it; deleting the account ends
  every assistant's access within about a minute.

**Professional advisors.** Professional advisors, such as lawyers, auditors,
bankers and insurers, in the course of the professional services that they
render to us.

**Authorities and others.** Law enforcement, government authorities, and private
parties, as we believe in good faith to be necessary or appropriate for the
Compliance and protection purposes described above.

**Business transferees.** We may disclose personal information in the context of
actual or prospective business transactions (_e.g.,_ investments in Inteligir,
financing of Inteligir, or the sale, transfer or merger of all or part of
Inteligir or its assets). For example, we may need to share certain personal
information with prospective counterparties and their advisers. We may also
disclose your personal information to an acquirer, successor, or assignee of
Inteligir as part of any merger, acquisition, sale of assets, or similar
transaction, and/or in the event of an insolvency, bankruptcy, or receivership
in which personal information is transferred to one or more third parties as one
of our business assets.

## Your choices

In this section, we describe the rights and choices available to all users.
Users who are located in certain U.S. states and Europe can find additional
information about their rights below.

**Access or update your information.** If you have registered for an account
with us through the Service, you may review and update certain account
information by logging into the account. Settings › Account on a Mac shows the
account it is signed in to, when it last synced, and your devices with when each
was last seen; our website's account pages list your devices too. The sign-in
page can email you a link to set a new password. To change anything else, such
as your name or email address, contact us.

**Privacy settings.** Signing a device out of your account (Settings › Account)
stops it syncing, and on a Mac deletes its copy of your library.

**Cookies and other technologies.** Most browsers let you remove or reject
cookies, and clear what a website keeps in web storage, in their settings. If
you block our website's session cookie, you cannot sign in to its account pages;
the apps do not depend on it. If you clear our website's web storage, it forgets
your theme and shows its dark one, and your library in a browser tab forgets its
settings and layout and follows your device's theme.

**Do Not Track.** Some Internet browsers may be configured to send "Do Not
Track" signals to the online services that you visit. We currently do not
respond to "Do Not Track" signals because the Service does not track you across
other websites.

**Declining to provide information.** We need to collect personal information to
provide certain services. If you do not provide the information we identify as
required or mandatory, we may not be able to provide those services. The
Service needs an account: your library is your account's.

**Delete your content or close your account.** You can choose to delete certain
content through your account: deleting an item moves it to Deleted, and emptying
Deleted or Delete forever removes it, with what Undo kept of it (see
[Retention](#retention)). Deleting a conversation with
the built-in agent deletes it from our cloud and every device, one still
running stopped first. To delete everything our cloud holds for you, delete your
account: Settings › Account › Delete account…, on any Mac or browser tab signed
in to it. It asks for your password again, and our cloud checks the
password before it deletes anything, so this Mac's sign-in alone cannot end the
account. If you lost your Mac, sign in on any other and delete from there. The
Mac you delete from is signed out; every other device is refused at its next
request. You can also ask us to close your account by writing to kai@kyh.io from
the account's email address.

Deleting the account deletes the account's data, in this order, before the
account row itself goes:

1. **Your library's store in our cloud is closed**, and your devices' live
   connections to it with it: from this moment it refuses every request, so
   nothing that arrives during the deletion can write to it.
2. **Your conversations with the built-in agent are deleted**, one still
   running stopped first, while the store still names them: our cloud keeps
   their ids nowhere else.
3. **Everything in that store is deleted**: every item, its text and what Undo
   keeps. What stays is a marker saying when it was deleted and nothing
   else, so a request already on its way still finds it closed.
4. **The files your library names** (images, PDFs and the like) are deleted
   from our storage.
5. **Every assistant's access is revoked**, its tokens with it.
6. **Every device row you own**, with its throttling counters, is deleted from
   D1, and **your email is dropped from the invite you redeemed** (the code
   stays burned). This is late on purpose: until then your device can still ask
   again if a step failed.
   Then Better Auth deletes your sessions, your password hash and the account row,
   and the rows for assistants you disconnected go with it.
   All six steps run BEFORE that, so a step that fails aborts the deletion and
   leaves the account able to ask again; every step is idempotent, so asking again
   resumes. Each of your devices erases its copy the next time our cloud refuses it
   (see [Retention](#retention)). The throttling rows keyed on an address, a
   browser session or an assistant's access, and an unused reset link's row, are
   not found by it (see [Retention](#retention)), and Cloudflare's request log
   lapses on its own.

## Other sites and services

The Service may contain links to websites, mobile applications, and other online
services operated by third parties. In addition, our content may be integrated
into web pages or other online services that are not associated with us. These
links and integrations are not an endorsement of, or representation that we are
affiliated with, any third party. We do not control websites, mobile
applications or online services operated by third parties, and we are not
responsible for their actions. We encourage you to read the privacy policies of
the other websites, mobile applications and online services you use.

## Security

We employ technical, organizational and physical safeguards designed to protect
the personal information we collect. However, security risk is inherent in all
internet and information technologies and we cannot guarantee the security of
your personal information.

Your library and your conversations with the built-in agent live in Durable
Objects of your own. The rest of what our cloud keeps for your account is filed
under your account in storage every account shares: rows in Cloudflare D1 that
name your account, your files under your account's own prefix in
R2, and each assistant's grant and tokens under your account in KV. A few things
are not filed that way: the throttling rows, an unused reset link's row, what an
assistant registered, a link waiting in the Queue for our cloud to read it,
which has your account's id beside it, and Cloudflare's own logs of each request
and of each call the built-in agent makes. Your password and each device
credential are kept only as hashes, and the apps talk to our cloud over HTTPS.

These are the edges of that protection, stated plainly:

- **We can read what our cloud holds.** Your library is stored unencrypted to
  us (Cloudflare encrypts its storage at rest, but there is no end-to-end
  encryption). Don't keep in it what you wouldn't store in a hosted notes app.
- **A lost phone holds a full copy of your library's text**, behind its
  passcode. Revoke it from Settings › Account on a Mac: it erases its
  copy the next time it goes online, but a phone that never does keeps it.
- **Deleting an item does not delete it at once**: it waits in Deleted, and
  what Undo keeps of its changes stays seven days, as [Retention](#retention)
  says, unless you delete the item for good or delete the account first.
- **An image or file you paste, drop or save is kept as the file it was**, on
  every device and in the browser alike, with any location or camera details it
  carries, a picture pasted into a note's text on the phone included; only a
  photo the phone's photo button adds is saved again without them.
- **A revoked device stops at the next request**, and its live connection is
  closed as part of the revoke — but revocation cannot reach a response already
  in flight.
- **Signing out on a device revokes it the same way, but only if our cloud hears
  the sign-out.** Settings › Account on a Mac waits for a connection. The phone,
  the browser extension and a Mac whose library will not open go on without one.
  A device our cloud did not hear from forgets its credential while its row stays
  active, until you revoke it from Settings › Account on a Mac or from the
  account pages on our website.

## International data transfer

We are based in the United States and may use service providers that operate in
other countries. Your personal information may be transferred to the United
States or other locations where privacy laws may not be as protective as those
in your state, province, or country.

Users in Europe should read the important information provided below about
transfer of personal information outside of Europe.

## Children

The Service is not intended for use by anyone under 18 years of age. If you are
a parent or guardian of a child from whom you believe we have collected personal
information in a manner prohibited by law, please contact us. If we learn that
we have collected personal information through the Service from a child without
the consent of the child's parent or guardian as required by law, we will comply
with applicable legal requirements to delete the information.

## Changes to this Privacy Policy

We reserve the right to modify this Privacy Policy at any time. If we make
material changes to this Privacy Policy, we will notify you by updating the date
of this Privacy Policy and posting it on the Service or other appropriate means.
Any modifications to this Privacy Policy will be effective upon our posting the
modified version (or as otherwise indicated at the time of posting). In all
cases, your use of the Service after the effective date of any modified Privacy
Policy indicates your acknowledging that the modified Privacy Policy applies to
your interactions with the Service and our business.

## How to contact us

If you have questions about our practices or if you would like to exercise any
privacy related right that may be available to you, please contact us via one of
the methods listed below.

- **Email**: kai@kyh.io

For a question that involves no personal information, such as a bug report, you
can also open an issue on [GitHub](https://github.com/kyh/inteligir/issues).
Issues are public, so please leave the contents of your library out of them.

## State privacy rights notice

Except as otherwise provided, this section applies to residents of U.S. states
to the extent they have privacy laws applicable to us that grant their residents
the rights described below (collectively the "**State Privacy Laws**").

This section describes how we collect, use, and share Personal Information of
residents of these states and the rights these users may have with respect to
their Personal Information. Please note that not all rights listed below may be
afforded to all users and that if you are not a resident of one of these states
listed above, you may not be able to exercise these rights. In addition, **we
may not be able to process your request if you do not provide us with sufficient
detail to allow us to confirm your identity or understand and respond to it. To
confirm your identity, we will ask you to send your request from, or confirm it
from, the email address associated with your account.**

For purposes of this section, the term "**Personal Information**" has the
meaning given to "personal data", "personal information" or other similar terms
and "**Sensitive Personal Information**" has the meaning given to "sensitive
personal information," "sensitive data", or other similar terms in the State
Privacy Laws, except that in neither case does such term include information
exempted from the scope of the State Privacy Laws.

**Your privacy rights.** The State Privacy Laws may provide residents with some
or all of the rights listed below. However, these rights are not absolute and
some State Privacy Laws do not provide these rights to their residents.
Therefore, we may decline your request in certain cases as permitted by law.

- **Information.** You can request the following information about how we have
  collected and used your Personal Information:
  - The categories of Personal Information that we have collected.
  - The categories of sources from which we collected Personal Information.
  - The business or commercial purpose for collecting and/or selling Personal
    Information.
  - The categories of third parties with which we share Personal Information.
  - The categories of Personal Information that we sold or disclosed for a
    business purpose.
  - The categories of third parties to whom the Personal Information was sold or
    disclosed for a business purpose.
- **Access.** You can request a copy of the Personal Information that we have
  collected about you.
- **Appeal.** You can appeal our denial of any request validly submitted.
- **Correction.** You can ask us to correct inaccurate Personal Information that
  we have collected about you.
- **Deletion.** You can ask us to delete the Personal Information that we have
  collected from you.
- **Opt-out.**
  - **Opt-out of certain processing for targeted advertising purposes.** We do
    not process your personal information for targeted advertising purposes.
  - **Opt-out of or appeal profiling/automated decision making.** We do not use
    your Personal Information to engage in profiling or to perform automated
    decision-making that results in significant financial impacts, significant
    impacts on housing, education, employment, health care, or criminal justice,
    or similarly significant impacts.
  - **Opt-out of other sales of personal data.** We do not sell your Personal
    Information within the meaning of State Privacy Laws.
- **Consumers under 16.** We do not have actual knowledge that we collect, sell
  or share the personal information of consumers under 16 years of age.
- **Sensitive Personal Information.** While we process certain categories of
  Sensitive Personal Information as described in this Privacy Policy, such as
  the login credentials for your account, we do not process Sensitive Personal
  Information for the purpose of inferring characteristics about consumers under
  the CCPA.
- **Nondiscrimination.** You are entitled to exercise the rights described above
  free from discrimination as prohibited by the State Privacy Laws.

**Exercising your right to opt-out of the "sale" or "sharing" of your Personal
Information.** We do not sell your Personal Information or "share" it for
cross-context behavioral advertising, as the State Privacy Laws define those
terms, so there is nothing to opt out of. If that ever changes, we will update
this Privacy Policy first, offer a way to opt out, and honor Global Privacy
Control ("GPC") signals as valid opt-out requests, as required by applicable
law.

**Exercising other state privacy rights.** You may submit requests to exercise
any of the other state privacy rights listed above via email to kai@kyh.io.

**Verification of Identity; Authorized agents.** We may need to verify your
identity in order to process your information, access, appeal, correction, or
deletion requests and reserve the right to confirm your residency. To verify
your identity, we may require government identification, a declaration under
penalty of perjury, or other information, where permitted by law.

Under some State Privacy Laws, you may enable an authorized agent to make a
request on your behalf. However, we may need to verify your authorized agent's
identity and authority to act on your behalf. We may require a copy of a valid
power of attorney given to your authorized agent pursuant to applicable law. If
you have not provided your agent with such a power of attorney, we may ask you
to take additional steps permitted by law to verify that your request is
authorized, such as by providing your agent with written and signed permission
to exercise your State Privacy Laws rights on your behalf, the information we
request to verify your identity, and confirmation that you have given the
authorized agent permission to submit the request.

**Information practices.** The following describes our practices currently and
during the past 12 months:

- **Sources and purposes.** We collect all categories of personal information
  from the sources and use them for the business/commercial purposes described
  above in the Privacy Policy.
- **Retention.** The criteria for deciding how long to retain personal
  information is generally based on whether such period is sufficient to fulfill
  the purposes for which we collected it as described in this notice, including
  complying with our legal obligations.
- **Deidentification.** We do not attempt to reidentify deidentified information
  derived from personal information, except for the purpose of testing whether
  our deidentification processes comply with applicable law.

**Personal information that we collect, use and disclose.** We have summarized
the Personal Information we collect, the purposes for which we collect it and
the third parties to whom we may disclose it by reference below to both the
categories defined in the "[Personal information we
collect](#personal-information-we-collect)" section of this Privacy Policy above
and the categories of Personal Information specified in the CCPA (Cal. Civ. Code
§1798.140). This chart describes our practices currently and during the 12
months preceding the effective date of this Privacy Policy. Information you
voluntarily provide to us, such as in free-form webforms, may contain other
categories of personal information not described below.

| Personal Information ("PI") we collect | CCPA statutory category                                                                                                                            | Purposes                                                                                                    | Categories of third parties to whom we "disclose" PI for a business purpose                                             | Categories of third parties to whom we "sell" or "share" PI |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Contact data                           | Identifiers; California Customer Records                                                                                                           | Service delivery and operations; Compliance and protection; Data sharing in the context of corporate events | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |
| Profile data                           | Identifiers; California Customer Records; Sensitive personal information (your account's login credentials)                                        | Service delivery and operations; Compliance and protection; Data sharing in the context of corporate events | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |
| Communications data                    | Identifiers; California Customer Records; Audio, electronic, visual or similar information (screenshots you send)                                  | Service delivery and operations; Compliance and protection; Data sharing in the context of corporate events | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |
| User-generated content and input data  | Any category the content you create holds, such as Identifiers and Audio, electronic, visual or similar information (photos and other attachments) | Service delivery and operations; Compliance and protection; Data sharing in the context of corporate events | Service providers; Third parties designated by you; Professional advisors; Authorities and others; Business transferees | None                                                        |
| Data from service providers            | Identifiers; Internet or other electronic network activity information; Audio, electronic, visual or similar information (screenshots you send)    | Service delivery and operations; Compliance and protection                                                  | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |
| Device data                            | Identifiers; Internet or other electronic network activity information                                                                             | Service delivery and operations; Service personalization; Compliance and protection                         | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |
| Online activity data                   | Internet or other electronic network activity information                                                                                          | Service delivery and operations; Compliance and protection                                                  | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |

**Additional information for California residents.**

**Shine the light law.** Under California's Shine the Light law (California
Civil Code Section 1798.83), California residents may ask companies with whom
they have formed a business relationship primarily for personal, family or
household purposes to provide the names of third parties to which they have
disclosed certain personal information (as defined under the Shine the Light
law) during the preceding calendar year for their own direct marketing purposes,
and the categories of personal information disclosed. We do not disclose
personal information to third parties for their own direct marketing purposes.
You may send us requests for this information to kai@kyh.io. In your request,
you must include the statement "Shine the Light Request," and provide your first
and last name and mailing address and certify that you are a California
resident. We reserve the right to require additional information to confirm your
identity and California residency. Please note that we will not accept requests
via telephone, mail, or facsimile, and we are not responsible for notices that
are not labeled or sent properly, or that do not have complete information.

**Additional information for Nevada residents.** Nevada residents have the right
to opt-out of the sale of certain personal information for monetary
consideration. While we do not currently engage in such sales, if you are a
Nevada resident and would like to make a request to opt out of any potential
future sales, please email kai@kyh.io.

**Contact Us.** If you have questions or concerns about our privacy policies or
information practices, please contact us using the contact details set forth in
the [How to contact us](#how-to-contact-us) section above.

## Notice to European users

### General

**Where this Notice to European users applies.** The information provided in
this "Notice to European users" section applies only to individuals in the
United Kingdom and the European Economic Area (i.e., "Europe" as defined at the
top of this Privacy Policy).

**Personal information.** References to "personal information" in this Privacy
Policy should be understood to include a reference to "personal data" (as
defined in the GDPR) - i.e., information about individuals from which they are
either directly identified or can be identified.

**Controller.** Kaiyu Hsu, who provides Inteligir, is the controller in respect
of the processing of your personal information covered by this Privacy Policy
for purposes of European data protection legislation (i.e., the EU GDPR and the
so-called 'UK GDPR' (as and where applicable, the "**GDPR**")). See the '[How to
contact us](#how-to-contact-us)' section above for our contact details.

### Our legal bases for processing

In respect of each of the purposes for which we use your personal information,
the GDPR requires us to ensure that we have a "legal basis" for that use.

Our legal bases for processing your personal information described in this
Privacy Policy are listed below.

- Where we need to perform a contract, we are about to enter into or have
  entered into with you ("**Contractual Necessity**").
- Where it is necessary for our legitimate interests and your interests and
  fundamental rights do not override those interests ("**Legitimate
  Interests**"). More detail about the specific legitimate interests pursued in
  respect of each Purpose we use your personal information for is set out in the
  table below.
- Where we need to comply with a legal or regulatory obligation ("**Compliance
  with Law**").
- Where we have your specific consent to carry out the processing for the
  Purpose in question ("**Consent**").

We have set out below, in a table format, the legal bases we rely on in respect
of the relevant Purposes for which we use your personal information - for more
information on these Purposes and the data types involved, see '[How we use your
personal information](#how-we-use-your-personal-information)'.

| Purpose                                                    | Categories of personal information involved                                                                                      | Legal basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service delivery and operations                            | Contact data; Profile data; Communications data; User-generated content and input data; Data from service providers; Device data | Contractual Necessity.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Security                                                   | Contact data; Profile data; Device data; Online activity data                                                                    | Compliance with Law. Legitimate Interests. We have a legitimate interest in ensuring the ongoing security and proper operation of our Service and associated IT services, systems, and networks.                                                                                                                                                                                                                                                                                                                |
| Service personalization                                    | Device data                                                                                                                      | Legitimate Interests. We have a legitimate interest in providing you with a good service, which is personalised to you and that remembers your selections and preferences.                                                                                                                                                                                                                                                                                                                                      |
| Compliance and protection                                  | Any and all data types relevant in the circumstances                                                                             | Compliance with Law. Legitimate Interests. Where Compliance with Law is not applicable, we and any relevant third parties have a legitimate interest in participating in, supporting, and following legal process and requests, including through co-operation with authorities. We and any relevant third parties may also have a legitimate interest of ensuring the protection, maintenance, and enforcement of our and their rights, property, and/or safety.                                               |
| Data sharing in the context of corporate events            | Any and all data types relevant in the circumstances                                                                             | Legitimate Interests. We and any relevant third parties have a legitimate interest in providing information to relevant third parties who are involved in an actual or prospective corporate event (including to enable them to investigate - and, where relevant, to continue to operate - all or relevant part(s) of our operations). However, we would always look to take steps to minimize the amount and sensitivity of any personal information shared in these contexts where possible and appropriate. |
| To create aggregated, de-identified and/or anonymized data | Any and all data types relevant in the circumstances                                                                             | Legitimate Interests. We have legitimate interest, and believe it is also in your interests, that we are able to take steps to ensure that our Services operate as intended.                                                                                                                                                                                                                                                                                                                                    |
| Further uses                                               | Any and all data types relevant in the circumstances                                                                             | The original legal basis relied upon, if the relevant further use is compatible with the initial purpose for which the Personal Information was collected. Consent, if the relevant further use is not compatible with the initial purpose for which the personal information was collected.                                                                                                                                                                                                                    |

### Retention

We retain personal information for as long as necessary to fulfil the purposes
for which we collected it, including for the purposes of satisfying any legal,
accounting, or reporting requirements, establishing or defending legal claims,
or for Compliance and protection purposes.

To determine the appropriate retention period for personal information, we
consider the amount, nature, and sensitivity of the personal information, the
potential risk of harm from unauthorized use or disclosure of your personal
information, the purposes for which we process your personal information and
whether we can achieve those purposes through other means, and the applicable
legal requirements.

When we no longer require the personal information we have collected about you,
we will either delete or anonymize it or, if this is not possible (for example,
because your personal information has been stored in backup archives), then we
will securely store your personal information and isolate it from any further
processing until deletion is possible. If we anonymize your personal information
(so that it can no longer be associated with you), we may use this information
indefinitely without further notice to you.

### Other info

**No sensitive personal information.** We do not ask you for any sensitive
personal information (e.g., social security numbers, information related to
racial or ethnic origin, political opinions, religion or other beliefs, health,
biometrics or genetic characteristics, criminal background or trade union
membership). Your library and conversations are yours to write, and if you choose
to include sensitive personal information in content you create and sync through
the Service, you consent to our processing it in accordance with this Privacy
Policy solely to provide the Service to you. If you do not consent, do not
include it in what you sync.

**No Automated Decision-Making and Profiling.** As part of the Service, we do
not engage in automated decision-making and/or profiling, which produces legal
or similarly significant effects.

### Your rights

**General.** European data protection laws give you certain rights regarding
your personal information. If you are located in Europe, you may ask us to take
the following actions in relation to your personal information that we hold:

- **Access.** Provide you with information about our processing of your personal
  information and give you access to your personal information.
- **Correct.** Update or correct inaccuracies in your personal information.
- **Delete.** Delete your personal information where there is no good reason for
  us continuing to process it - you also have the right to ask us to delete or
  remove your personal information where you have exercised your right to object
  to processing (see below).
- **Transfer.** Transfer a machine-readable copy of your personal information to
  you or a third party of your choice.
- **Restrict.** Restrict the processing of your personal information, for
  example if you want us to establish its accuracy or the reason for processing
  it.
- **Object.** Object to our processing of your personal information where we are
  relying on Legitimate Interests - you also have the right to object where we
  are processing your personal information for direct marketing purposes.
- **Withdraw Consent.** When we use your personal information based on your
  consent, you have the right to withdraw that consent at any time.

**Exercising These Rights.** You may submit these requests by email to
kai@kyh.io. We may request specific information from you to help us confirm your
identity and process your request. Whether or not we are required to fulfill any
request you make will depend on a number of factors (e.g., why and how we are
processing your personal information), if we reject any request you may make
(whether in whole or in part) we will let you know our grounds for doing so at
the time, subject to any legal restrictions.

**Your Right to Lodge a Complaint with your Supervisory Authority.** In addition
to your rights outlined above, if you are not satisfied with our response to a
request you make, or how we process your personal information, you can make a
complaint to the data protection regulator in your habitual place of residence.

- For users in the European Economic Area - the contact information for the data
  protection regulator in your place of residence can be found here:
  https://www.edpb.europa.eu/about-edpb/our-members_en
- For users in the UK - the contact information for the UK data protection
  regulator is below: The Information Commissioner's Office, Water Lane,
  Wycliffe House, Wilmslow – Cheshire SK9 5AF, Tel. +44 303 123 1113, Website:
  https://ico.org.uk/make-a-complaint/

### Data Processing outside Europe

We are based in the U.S. and many of our service providers, advisers or other
recipients of data are also based in the U.S. This means that, if you use the
Service, your personal information will necessarily be accessed and processed in
the U.S. It may also be provided to recipients in other countries outside
Europe.

It is important to note that the U.S. is not the subject of a general 'adequacy
decision' under the GDPR – the EU-U.S. Data Privacy Framework and its UK
Extension cover only organizations certified under them, and we are not
certified. Basically, this means that the U.S. legal regime is not considered by
relevant European bodies to provide an adequate level of protection for personal
information transferred to us, which is equivalent to that provided by relevant
European laws.

Where we share your personal information with third parties who are based
outside Europe, we try to ensure a similar degree of protection is afforded to
it by making sure one of the following mechanisms is implemented:

- **Transfers to territories with an adequacy decision.** We may transfer your
  personal information to countries or territories whose laws have been deemed
  to provide an adequate level of protection for personal information by the
  European Commission or UK Government (as and where applicable) (from time to
  time).
- **Transfers to territories without an adequacy decision.** We may transfer
  your personal information to countries or territories whose laws have not been
  deemed to provide such an adequate level of protection (e.g., the U.S., see
  above). However, in these cases:
  - we may use specific appropriate safeguards, which are designed to give
    personal information effectively the same protection it has in Europe - for
    example, standard-form contracts approved by relevant authorities for this
    purpose; or
  - in limited circumstances, we may rely on an exception, or 'derogation',
    which permits us to transfer your personal information to such country
    despite the absence of an 'adequacy decision' or 'appropriate safeguards' -
    for example, reliance on your explicit consent to that transfer.

You may contact us if you want further information on the specific mechanism
used by us when transferring your personal information out of Europe. You may
have the right to receive a copy of the appropriate safeguards under which your
personal information is transferred by contacting us at kai@kyh.io.

## Every address the app talks to

Your account's cloud is one origin, `https://inteligir.com`, and every call the
Mac, the phone, the browser extension and the library's browser tab make to it
is one of these routes, as is every call the account pages make but their
sign-in, session and password-reset calls, which go to Better Auth under
`/api/auth/`. Nothing else under `/v1/` exists.

| Route          | What it carries                                                                                                                                                                                                                                                                                                             | What authenticates it                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `/v1/rpc`      | Every call the apps make to read and change your library (items, their text, folders, tags, the changes Undo takes back and your messages to the agent) and your account (signing in, your devices, the assistants you connected, deleting the account), each one request with its contents in the body, never the address. | Your password or invite code to sign in or up; otherwise the device's credential or your signed-in browser session, within a budget of its own. |
| `/v1/blobs`    | Your library's files (images, PDFs and any other file you save), each sent once and read back by a fingerprint of its contents, never its name; a file whose contents do not match its fingerprint, or that the library has no room for, is not kept.                                                                       | The device's credential or your signed-in browser session, within a budget of its own.                                                          |
| `/api/sign-up` | Your email, name, password and invite code, once, to create the account on the website.                                                                                                                                                                                                                                     | The invite code; attempts are throttled per caller address.                                                                                     |
| `/v1/socket`   | A live connection to your own signed-in devices that says your library changed and how far it has come, and carries a conversation with the built-in agent as it happens: each thing the agent does and its reply as it is written.                                                                                         | A one-minute pass your signed-in device or browser session asked for, its sign-in checked again.                                                |

Everything else the app reaches is someone else's:

- **GitHub's release feed**, for the desktop's update check described above.
- **Expo's update service**, for the phone's update check described above.
- **The sites you save**: from our cloud, for a link your library holds unread,
  with the cover files they name, the cover a Raindrop import recorded, and
  the oEmbed addresses above; and from the browser the extension runs in, for
  the cover picture of a page it saves.

---

This template was prepared and made publicly available by General Legal, PC
("General Legal"). It is provided for general reference purposes only and does
not constitute, and should not be construed as, legal advice, or an endorsement
or review of any particular transaction in which it is used. Use of this
template does not create an attorney-client relationship with General Legal.
General Legal has not reviewed, and takes no position on, any modifications made
to this document or the deal terms it is used to document.
