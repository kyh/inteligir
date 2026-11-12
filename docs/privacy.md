# Privacy Policy

Effective as of November 12, 2026.

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
on reads your library from our cloud and sends what you change there, and our
cloud tells your other devices when one has changed it. Your conversations with
the built-in agent are kept with your library, so every device you sign in on
shows them; what the agent reads to answer you goes to Anthropic, which runs the
model for us (see [How we share your personal
information](#how-we-share-your-personal-information)).

**Information you provide to us.** Personal information you may provide to us
through the Service or otherwise includes:

- **Contact data**, such as your name and email address, which you give us when
  you create an account or write to us.
- **Profile data**, such as the email address and password you set to establish
  an account on the Service, the invite code you redeemed, and the devices you
  sign in. Specifically:
  - **Account data**: your name, your email, a hash of your password and the
    invite code you redeemed with your email beside it, kept by Better Auth,
    the sign-in software our cloud runs. Your password is sent over HTTPS only
    when you create the account (in the app or on our website; from the phone,
    that also signs the phone in) or sign a device in, and no device keeps it.
    A password reset emails you a link through Cloudflare's email sending.
  - **Sessions**: one per device you sign in, browser, Mac app and iPhone alike,
    holding a random token our cloud keeps to recognize that device, the IP
    address and user agent it signed in from (by which Settings › Account names
    it, such as Chrome on Mac) and when it was created, last used and expires. A
    sign-in lasts 60 days from its last use; an account keeps at most 20, a
    further sign-in ending the one used longest ago; a password reset ends them
    all. The browser extension uses its browser's session.
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
  location information, and other similar data. Specifically:
  - Every change a device of yours makes to items, files, folders and tags goes
    to your library in our cloud. What you type in a note goes there as you type
    it and on to every device that has the note open, as do the built-in agent's
    edits. Nobody learns who else has a note open or where their cursor is.
  - For seven days, so Undo can take it back, your library keeps what each
    change to an item's fields, a folder or a tag replaced, and what the
    built-in agent, an assistant, an import or a reading of a page changed, each
    change named for the device, assistant or conversation that made it. What
    you type in a note is not kept for Undo.
  - Your library is reachable only with a sign-in to your own account and holds
    about 1 GB, each note's text and what Undo keeps included. A full library
    still opens, downloads and lets you edit what it holds, but takes no new
    items or files, and says so. A note holds about 8 MB; a full one takes no
    more typing, and says so. A file over 100 MB is never kept. We can read
    your library (see [Security](#security)).
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
  - **Each session** keeps the IP address and user agent it signed in from (see
    Sessions, above).
  - **Your IP address, to stop password guessing: the one record not tied to
    your account.** Before you sign in, your address is all our cloud knows of
    you, so it counts attempts per address (an IPv6 address shortened to its
    first 64 bits) to create an account, redeem an invite, sign in or use any
    other sign-in page but the session check, and for an assistant to register
    itself to connect. Each count holds the address, what it counts, a number
    and a time. Once you are signed in, attempts to delete the account are
    counted the same way under the session, never an address; your devices'
    reads and writes of your library are counted per session, and an
    assistant's calls per the access you gave it, by Cloudflare's own rate
    limiter over a minute, with no record in our database.
  - **The app's version.** The phone app and the browser extension name
    themselves and their version on each request, so our cloud can refuse a
    version too old to work with it rather than answer it wrongly. Our cloud
    keeps no record of it.
  - **The Mac app's update check, to GitHub.** The Mac app asks GitHub's release
    feed whether a newer version exists each time its window opens your library
    and when you choose Check for Updates…; it downloads one only when you
    choose Download, and installs it when you choose Restart. GitHub sees your
    IP address, nothing about your library or your account.
  - **The phone's update check, to Expo.** Each time the phone app starts, it
    asks Expo's update service for newer app code, downloads it in the
    background and runs it from the next start. Expo sees your IP address, the
    app's build and a random id the app keeps for that install, nothing about
    your library or your account.
- **Online activity data**, limited to **a log of each request, kept by
  Cloudflare.** Cloudflare logs each request our cloud answers, the pages of our
  website included (the address asked for, less anything after a `?` in it, the
  answer's status and the time), and keeps it for up to seven days, for us to
  diagnose failures with; about one request in a hundred is traced in more
  detail. An address never holds a file's name or anything you wrote, which the
  apps send in a request's body; a file's address holds a fingerprint of its
  contents, which identifies that exact file. Our cloud's error lines give that
  address or the name of what failed, with the opening of the error's message,
  which can quote what it was given.

For more information concerning our automatic collection of data, please see the
[Tracking & Other Technologies](#tracking--other-technologies) section below.

**Data about others.** Your library may hold personal information about other
people, and our cloud holds your library. Please do not share someone else's
personal information with us through the Service unless you have their
permission to do so.

## Tracking & Other Technologies

**Cookies and other technologies.** Some of our automatic data collection is
facilitated by cookies and other technologies. The Service uses only these:

- **Essential.** Our website sets one first-party cookie, Better Auth's session
  cookie, when you sign in or create an account there. It keeps you signed in
  for 60 days, renewed each day you use it, and signs in your library in a
  browser tab and the Mac app's window, which keeps it in the app's own web
  storage on your Mac. When an assistant you are connecting sends you to our
  consent page, the page sets one more, for at most ten minutes and cleared once
  you answer, to tie your answer to the browser you were asked in. The iPhone
  app keeps a session cookie of its own in the iPhone's Keychain, for that
  iPhone alone and only while it is unlocked, and sends it only to our cloud.
  The browser extension keeps no cookie of its own: with the `cookies`
  permission for inteligir.com alone, it reads your browser's inteligir.com
  session cookie and sends it with each save.
- **Functionality / performance.** Our website keeps your choice of light or
  dark theme in your browser's local storage and never sends it to us; your
  library in a browser tab keeps its settings and layout there too, and the
  apps keep theirs on your device. The tab and the Mac app keep your account's
  id beside them, so what one account was viewing never opens for the next.
- **Analytics, advertising and social media.** We do not use analytics,
  advertising or social media cookies, or any similar technology, on our website
  or in the apps.

The apps also hold to these:

- **No telemetry.** The apps and the extension send none.
- **Nothing an item points at on the web loads when you open it**, on the Mac,
  the phone or in a browser tab: an image or embed at a web address is not
  fetched, so nobody learns you opened it. A link opens in your browser only
  when you follow it.
- **Saving a link: from our cloud, to that site.** A link that reaches your
  library without its page (pasted or saved on the Mac, in a browser tab or on
  the phone, saved by an assistant you connected or by the built-in agent once
  you allowed it, seeing the whole address, imported, refreshed, or sent by the
  browser extension as an address) is fetched once by our cloud, from
  Cloudflare's network, for its title, site, description, readable text and the
  cover image it names. For YouTube, Vimeo, X, TikTok, Spotify and SoundCloud
  our cloud asks that site's own oEmbed address (with X's `dnt=true`), for any
  other page the oEmbed address the page names, and fetches the picture that
  answer names; for a YouTube video it may fetch the video's still picture from
  YouTube; for a link imported from Raindrop, the cover Raindrop recorded. Each
  request carries no cookies, sign-in or referrer, names inteligir in a
  Safari-compatible user agent with English as its language, and shows the site
  Cloudflare's address, never yours. Our cloud fetches only web addresses on
  their standard ports, and never one that points into a private network or
  into space no site holds, whether you saved it or a page redirected there.
  The page's text and pictures land in your library; the page itself is not
  kept.
- **The browser extension.** The Inteligir extension for Chrome, Arc, Brave,
  Edge and Vivaldi reads the page you are on only when you click Save or choose
  Save from the right-click menu. It reads the page as shown (its address, title
  and HTML without its scripts) and sends its text, the facts the page gives
  about itself and its cover picture, which it fetches from your browser without
  your cookies, to your library, signed in as the account you are signed in to
  on inteligir.com in that browser. Signing out there, or signing that browser
  out from Settings › Account, signs the extension out too. It keeps only the
  account's email and the site's address in its storage. Nothing you typed into
  the page goes with it: form fields, choices the page filled in for you and
  every box you type into, such as an email you are writing, are emptied first.
  A link or picture saved from the right-click menu, and a page the extension
  cannot read (the Web Store, a PDF, a page too large to read or send, or one
  with no text), go as an address, the page with its title, for our cloud to
  read as above. A page with no web address, such as the browser's own pages,
  is never saved: the extension says so and sends nothing. A picture a page drew
  itself is uploaded as a file of its own. A save made offline or signed out
  waits in the extension's browser storage as the page's address and title, and
  is sent, for our cloud to read, once you are online and signed in as that
  account; one for an account that was deleted is dropped.
- **Sharing from your iPhone.** Sharing a page or a link to Inteligir saves its
  address, with the title the sharing app gave it and the words you shared,
  into your library; the phone fetches nothing from the site, and our cloud then
  reads the page as above, so a page only your own network reaches is not read.
  A link inside shared text is saved the same way, the words around it its note;
  other text is saved as you shared it.
- **Importing.** The file you import (a Raindrop CSV, or a zip of notes such as
  an Obsidian folder) is uploaded to your library, read there and deleted once
  the import ends. Each imported link is then read as above.
- **Your voice.** Neither the Mac app nor the phone app ever opens the
  microphone. Dictation is your operating system's own (on a Mac, press fn
  twice; on the phone, the keyboard's microphone key) and types into the app
  like a keyboard; where that audio goes is Apple's to say, under its own
  settings and terms.
- **A phone photo.** The phone opens the camera only when you take a photo to
  add to your library, and receives from your photo library only the photo you
  pick. Only a copy reaches your library: at most 2048 pixels on its long side,
  saved again as a JPEG, or a PNG if it was one, named for when you added it,
  without its location or any other camera details. A picture you paste into a
  note's text is not saved again: it reaches your library as the file you
  pasted, with whatever details it carries.
- **The Mac app shows your library from our website**, keeping each file you
  opened in its web cache as a browser does; signing out empties that cache, in
  the app or the browser, and the page's settings stay. The app keeps no log.

**Chat and other artificial intelligence ("AI") technologies**, such as
Anthropic's Claude, which our cloud runs to operate the built-in agent you can
ask to read, file, draft and edit your library through the Service, and the
assistant you connect yourself, such as Claude or ChatGPT. Specifically:

- **The built-in agent runs in our cloud, on our account with Anthropic, not
  yours**: no device of yours talks to Anthropic, and you sign nothing in. What
  you ask it, the items you were looking at or selected, and what it reads of
  your library to answer go to Anthropic through Cloudflare's AI Gateway (see
  [How we share your personal
  information](#how-we-share-your-personal-information)).
- **An assistant you connect** on our consent page reads and changes your
  library through our cloud, and what it reads goes to its provider under the
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

- **Items** stay until deleted for good or the account is deleted. Deleting an
  item moves it to Deleted; emptying Deleted, or Delete forever, removes its
  text and what Undo kept of it at once, and each of its files once no other
  item, and nothing Undo can still bring back, names it.
- **What Undo keeps** of a change stays seven days after the change is finished
  and is deleted within about a day after that. For each turn of the built-in
  agent that edited a note, the note's own store keeps the note as it stood at
  the turn's first edit there and every change through its last, so Undo this
  turn can take it back, for the same time.
- **A conversation with the built-in agent**, its own record and its messages in
  your library alike, is kept until you delete it or the account, which deletes
  both.
- **A session** is deleted when that device signs out, when another device signs
  it out from Settings › Account, when a password reset or the 20-session limit
  ends it, and, once it has lapsed 60 days after its last use, the next time it
  is presented; the rest go with the account.
- **Throttling counts** are keyed on an address, a session or an assistant's
  access, never an account, so deleting the account, ending a session or
  removing an assistant does not find them. A count over a minute old is deleted
  the next time a request to our sign-in service, from anyone, starts a fresh
  count; nothing clears them on a timer.
- **A password-reset link** is deleted when used. An unused one stops working
  after an hour and is deleted the next time anyone opens a reset link; deleting
  the account does not look for it, and once the account is gone it opens
  nothing.
- **An assistant you connected** keeps its access until you Disconnect it in
  Settings › Account › Connected assistants, which ends it at once, or until 30
  days after it last renewed it, which it does while it keeps using it: removing
  the connector in the assistant stops its requests, and its access lapses at
  those 30 days. Deleting the account ends every assistant's access within about
  a minute. A record of each assistant you disconnected (its access's id and
  your account) stays until the account is deleted, so one renewing its access
  at that moment stays out. What an assistant registered (its name and
  addresses, never yours) is filed under no account, so deleting the account
  leaves it until it is deleted 90 days after the assistant last used it.
- **Cloudflare's request log** keeps each entry for up to seven days.

**Your phone.** Signed in, the phone keeps what it last read of your library, so
that still shows with no connection: the items, lists, folders and
conversations it showed, a small picture for each card, and a picture, PDF or
other file once you open it. A page or text you share to Inteligir waits on the
phone until your library takes it; one the library refuses stays on the phone
and says so. Nothing else waits: a save typed into the app, a photo, a deletion
or typing in a note needs a connection, and says so.

It all lives in the app's own storage, out of the phone's iCloud backup: a phone
restored from a backup reads your library again, and a share it had not sent is
gone. The files you opened sit in the app's cache, which iOS may clear and never
backs up. The phone's sign-in is kept in the iPhone's Keychain for that iPhone
alone, so a backup restored onto another phone does not carry it, and the new
phone signs in again as a device of its own.

- **Signing out** on the phone erases all of it, asking first about any shares
  waiting, and tells our cloud to end the phone's session. A phone that signs
  out offline forgets its sign-in all the same; sign it out from Settings ›
  Account on the Mac or at inteligir.com/library to end that session too.
- **Signing the phone out from another device**, or **deleting the account**,
  erases the same, without asking, the next time the phone opens or reaches our
  cloud and is refused. Until then it keeps what it holds.

## How we share your personal information

We may share your personal information with the following parties (or as
otherwise described in this Privacy Policy, in other applicable notices, or at
the time of collection).

**Service providers.** Third parties that provide services on our behalf or help
us operate the Service or our business (such as hosting, information technology
and email delivery). Specifically:

- **Cloudflare** runs our cloud and our website:
  - its D1 database holds your account, sessions, the invite you redeemed, an
    unused password-reset link, the record of each assistant you disconnected
    and the throttling counts;
  - its KV storage holds each assistant you connected: what it registered (its
    name and the addresses it gave), its access, filed under your account with
    its name and what you let it do, and its tokens, kept only as hashes;
  - Durable Objects of your own hold your library, your devices' live
    connections and each conversation with the built-in agent;
  - its R2 storage holds your files, under your account's own prefix;
  - its Queues hold each link waiting for our cloud to read it (your account's
    id, the item's, its address and the address of any cover the save knew of)
    until it is read or recorded as unreadable;
  - its AI Gateway passes each request the built-in agent makes to Anthropic,
    asked to keep only its metadata (the model, how many tokens, its status,
    how long it took and your account's id, by which it holds each account to a
    daily limit of what the agent may spend), never what it carries;
  - its email sending delivers your password-reset emails, and it keeps the
    request log described above.
- **Anthropic** answers the built-in agent for us, on our account, not yours.
  What you ask it, what you were looking at, and everything it reads of your
  library to answer you (items, their text, folders and tags) go to Anthropic
  in each request it makes, through Cloudflare's AI Gateway, under Anthropic's
  terms with us. When a conversation grows long, Anthropic's API also writes a
  summary of its earlier part and hands it back with the answer; our cloud keeps
  it with the conversation and sends it in place of what it summarizes.
  Anthropic's API keeps none of those requests, summaries or answers once it has
  answered, past the parts it caches for at most an hour to answer the next
  request of the same conversation sooner. The conversation itself is kept by
  our cloud alone, so deleting it or the account leaves nothing to delete at
  Anthropic.
- **GitHub** hosts the Mac app's releases and its update feed, and the issues
  you open there.
- **Expo** answers the iPhone app's update check.
- **Apple** delivers the iPhone app through TestFlight.
- **The email services** that receive and forward the email you send us.

**Third parties designated by you.** We may share your personal information with
third parties where you have instructed us or provided your consent to do so,
from our cloud:

- **Your library, to an assistant you connect.** When you allow Claude, ChatGPT
  or another assistant on our consent page, which names the assistant as it
  named itself and where its access is sent, our cloud answers its requests from
  your library: what it searches for and reads (items, their text, folders and
  tags) goes to that assistant's provider under the provider's own terms, as
  part of your conversation there. What it writes lands in your library as a
  change named for it, which you can ask it to change back, and one you allowed
  only to read can change nothing. [Retention](#retention) says how its access
  ends.

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
information by logging into the account. Settings › Account, in the Mac app or
in your library at inteligir.com/library, shows the account it is signed in to
and every device signed in to it, named from the browser or app it signed in
with, with when each was last used. The sign-in page can email you a link to set
a new password. To change anything else, such as your name or email address,
contact us.

**Privacy settings.** Signing a device out of your account (Settings › Account)
ends its access, and on the phone deletes what it kept of your library.

**Cookies and other technologies.** Most browsers let you remove or reject
cookies, and clear what a website keeps in web storage, in their settings. If
you block our website's session cookie, you cannot sign in to its account pages
or your library there, and the browser extension, which uses that cookie, is
signed out with it; the Mac app and the iPhone app keep their own. If you clear
our website's web storage, it forgets your theme and follows your device's, and
your library in a browser tab forgets its settings and layout.

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
[Retention](#retention)). Deleting a conversation with the built-in agent
deletes it from our cloud and every device, stopping it first if it is still
running.

To delete everything our cloud holds for you, delete your account: Settings ›
Account › Delete account…, on any Mac or browser tab signed in to it. It asks
for your password again, and our cloud checks it before it deletes anything, so
a device's sign-in alone cannot end the account; if you lost your Mac, sign in
on any other and delete from there. The device you delete from is signed out,
and every other device is refused at its next request. You can also ask us to
close your account by writing to kai@kyh.io from the account's email address.

Deleting the account first closes your library, so nothing that arrives
meanwhile can write to it. It then deletes your conversations with the built-in
agent, stopping any still running, everything in your library (every item, its
text and what Undo keeps) and your files, revokes every assistant's access with
its tokens, and removes your email from the invite you redeemed, which stays
used. Last, it deletes your sessions, your password hash, your account and the
records of assistants you disconnected. If any step fails, the account stays
and you can delete it again, which picks up where it stopped. What remains is a
marker saying when your library was deleted, and nothing else, so a request
already on its way finds it closed. Each of your devices erases its copy the
next time our cloud refuses it. The throttling counts, an unused reset link and
Cloudflare's request log lapse as [Retention](#retention) says.

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
under your account in storage every account shares: database rows that name
your account, your files under your account's own prefix, and each assistant's
access and tokens under your account. A few things are not filed that way: the
throttling counts, an unused reset link, what an assistant registered, a link
waiting for our cloud to read it (with your account's id beside it), and
Cloudflare's own logs of each request and of each call the built-in agent makes.
Your password is kept only as a hash; each session is a random token our cloud
keeps as it is, to recognize that device; and the apps talk to our cloud over
HTTPS.

These are the edges of that protection, stated plainly:

- **We can read what our cloud holds.** Cloudflare encrypts its storage at
  rest, but there is no end-to-end encryption. Don't keep in your library what
  you wouldn't store in a hosted notes app.
- **A lost phone holds what it last read of your library**, behind its
  passcode. Signing it out from Settings › Account erases that the next time it
  goes online; a phone that never does keeps it.
- **Deleting an item does not delete it at once**: it waits in Deleted, and what
  Undo keeps of its changes stays seven days, unless you delete it for good or
  delete the account first.
- **An image or file you paste, drop or save is kept as the file it was**, on
  every device, with any location or camera details it carries; only a photo the
  phone's photo button adds is saved again without them.
- **A device signed out from Settings › Account stops at its next request**, and
  its live connection is closed, but signing it out cannot reach a response
  already on its way.
- **Signing out on a device ends its session only if our cloud hears it.** A
  browser tab or the Mac waits for a connection to sign out; the phone goes on
  without one. A session no sign-out reached stays listed, and works for
  whoever holds it, until another device signs it out from Settings › Account,
  the 20-session limit retires it or it lapses 60 days after its last use. The
  browser extension has no sign-out of its own: signing out of inteligir.com in
  that browser signs it out.

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

Every call the Mac app, the phone, the browser extension, your library in a
browser tab and our website's account pages make goes to one origin,
`https://inteligir.com`, over HTTPS, and is one of these:

- **Signing in and out, sessions and password resets**, which Better Auth
  answers, and **creating an account**, which an invite code admits.
- **Reading and changing your library and your account** (your devices, your
  connected assistants, deleting the account), each one request, its contents
  in its body and never its address, made with your device's session.
- **Your files**, each sent once and read back by a fingerprint of its
  contents, never its name; a file whose contents do not match its fingerprint
  is not kept.
- **Two live connections**, each opened on a one-minute pass your signed-in
  device asks for, its sign-in checked again: one says your library or a
  conversation with the built-in agent changed and how far it has come, and
  carries the agent's reply as it is written; the other carries each change to
  an open note's text to and from every device that has it open, and opens a
  note in Deleted read-only.

The apps call nothing else there. Everything else the app reaches is someone
else's: **GitHub's release feed** and **Expo's update service**, for the update
checks described above, and **the sites you save**, from our cloud for a link
your library holds unread (with the covers they name, the cover a Raindrop
import recorded, and the oEmbed addresses above) and from the browser the
extension runs in for the cover picture of a page it saves.

---

This template was prepared and made publicly available by General Legal, PC
("General Legal"). It is provided for general reference purposes only and does
not constitute, and should not be construed as, legal advice, or an endorsement
or review of any particular transaction in which it is used. Use of this
template does not create an attorney-client relationship with General Legal.
General Legal has not reviewed, and takes no position on, any modifications made
to this document or the deal terms it is used to document.
