# Privacy Policy

Effective as of October 8, 2026.

To view previous versions of this Privacy Policy, see its [history on
GitHub](https://github.com/kyh/inteligir/commits/main/docs/privacy.md).

**California Notice at Collection/State Privacy Rights Notice**: See the [State
privacy rights notice](#state-privacy-rights-notice) section below for important
information about your rights under applicable state privacy laws.

Kaiyu Hsu ("**Inteligir**," "**we**," "**us**" or "**our**") provides Inteligir,
a Mac app, with an iPhone app, that keeps the conversations of coding agents on
your Mac and, if you sign in, follows them on your other devices. Inteligir is
being rebuilt as an open-source companion for the coding agents you already
run; this version runs no agent and calls no AI model. This Privacy Policy describes how Inteligir processes personal information that we
collect through our digital or online properties or services that link to this
Privacy Policy (including, as applicable, our website at inteligir.com, our Mac
app, our iPhone app and the `inteligir` command line) and the other activities
described in this Privacy Policy (collectively, the "**Service**").

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

The Service is local-first: the app keeps its log of conversations on your Mac,
and an account is optional; without one the apps send our cloud nothing. Our
cloud is the part of the Service we run on Cloudflare, at inteligir.com. Signed
in, it carries your conversations between your devices and your phone's
requests to your Mac. This Privacy Policy states exactly what that means: what
leaves your machine, what never does, what your phone keeps, how long our cloud
keeps it, and how it is deleted.

Earlier versions of the Service were a notes app that also kept a hosted copy of
your notes and your quick captures in our cloud. This version holds neither, and
the first deployment of our cloud without them erases every hosted copy of
every account's notes and every capture still waiting (see
[Retention](#retention)).

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
- **User-generated content and input data**, such as your messages in a
  conversation and other content or information that you generate, transmit, or otherwise make available on the
  Service, as well as associated metadata. Metadata includes information on how,
  when, where and by whom a piece of content was collected and how that content
  has been formatted or edited. Metadata also includes information that users
  can add or can have added to their content, such as keywords, geographical or
  location information, and other similar data. Once you sign in, our cloud
  receives:
  - **Thread events** — the append-only log of your conversations with an
    agent: your messages, its replies, what its tools did (the text of files it
    read and the changes it made to them, as its tools reported them), its
    status, and each conversation's title, the agent it runs on and whether you
    archived it (a conversation an earlier version started over a note also
    names that note). Each Mac pushes them to your account's own thread-sync
    Durable Object so
    your other devices can follow along, and your phone keeps a copy. Our cloud
    stores these as opaque JSON and fans them out; it does not interpret them.
  - **Requests from your phone to your Mac** — what you ask on your phone (the
    text and the conversation it belongs to), and your answer when an agent asks
    your permission, held in the same per-user object until one of your Macs
    picks it up. The first Mac to pick a request up handles it there (this
    version runs no agent, so it answers that it cannot run it), and the
    conversation then syncs back as thread events. A request is handed to one Mac at a time;
    if that Mac stops mid-way the hold lapses after two minutes and another may
    take it. When a phone-started conversation needs your permission, the Mac
    running it sends the question (the command or the change the agent wants to
    make, and why) to the same place for your phone to answer. A Mac with Let my
    phone ask this Mac turned off in Settings never picks one up.
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
    Signing a device in, creating an account, redeeming an invite, and every
    Better Auth route but the session read count attempts per caller address in
    D1's `rate_limit` table: a row holds the address beside the route it counts,
    a count and a timestamp. Before sign-in the address is all our cloud knows
    about a caller, and a login with no throttle is a password oracle. Once
    signed in, a device's attempts to delete the account are counted the same
    way under the device's id, never an address.
  - **The update check — to GitHub.** The packaged desktop app asks GitHub's
    release feed whether a newer version exists 15 seconds after launch and
    every 4 minutes after that. GitHub sees your IP address, nothing about your
    conversations or your account. Nothing downloads or installs without a click. `inteligir serve`, from a checkout or through
    `npx`, makes no such check.
  - **The phone's update check — to Expo.** Each time the phone app starts it
    asks Expo's update service whether a newer version of its app code exists,
    downloads one in the background and runs it from the next start. Expo sees
    your IP address, the app's build and a random id the app keeps for that
    install, nothing about your conversations or your account.
- **Online activity data**, limited to **a log of each request, kept by
  Cloudflare.** Cloudflare, which runs our cloud, logs each request our cloud
  answers, the pages of our website included — the address asked for, the
  answer's status and the time — and keeps that log for up to seven days, for us
  to diagnose failures with; about one request in a hundred is traced in more
  detail. The address names a route, never a conversation, and our cloud's own
  error lines name a route, never what a request carried.

For more information concerning our automatic collection of data, please see the
[Tracking & Other Technologies](#tracking--other-technologies) section below.

**Data about others.** Content you sync, such as your conversations with an
agent, may hold personal information about other people,
and our cloud holds what you sync. Please do not share someone else's personal
information with us through the Service unless you have their permission to do
so.

## Tracking & Other Technologies

**Cookies and other technologies.** Some of our automatic data collection is
facilitated by cookies and other technologies. The Service uses only these:

- **Essential.** Our website sets one first-party cookie, Better Auth's session
  cookie, when you sign in or create an account there, so that its account pages
  (the list of your devices, for one) know it is you. It keeps you signed in to
  those pages for seven days, renewed as you use them. The Mac app and the
  iPhone app use no cookies. When you open the Service in a browser with
  `inteligir serve`, the server on your own Mac sets one cookie that lets that
  browser tab reach it; it is set and read on your Mac, never leaves it, and
  stops working when that server stops.
- **Functionality / performance.** Our website keeps your choice of light or
  dark theme in your browser's web storage (local storage), first-party, and
  never sends it to us; the apps keep their own settings and layout on your
  device.
- **Analytics, advertising and social media.** We do not use analytics,
  advertising or social media cookies, or any similar technology, on our website
  or in the apps.

The apps also hold to these, plainly:

- **Telemetry.** The apps send none, about your conversations or anything else.
- **Your voice.** Neither the Mac app nor the phone app ever opens the
  microphone. Dictation is your operating system's own — on a Mac, press fn
  twice; on the phone, the keyboard's microphone key — which types into the app
  like a keyboard; where that audio goes is Apple's to say, under its own
  settings and terms.
- **The app's log.** The desktop app keeps what its local server prints in
  `logs/server.log` inside its data folder (at most 5 MB, plus one older file),
  whether or not Debug logging is on; with it on (Settings › Advanced), the log
  also records each sync step by id, never what a message says or a credential. Nothing reads or sends it: it
  leaves the machine only if you attach it to a report yourself.

**Chat and other artificial intelligence ("AI") technologies.** This version of
the Service runs no AI agent and makes no call to an AI model, on your Mac, your
phone or our cloud. A conversation an earlier version ran stays in your thread
log as it was, and what that agent read then went to its provider (Anthropic or
OpenAI) under the provider's own terms; the app never held the provider's
sign-in, which stays in that provider's own store on your Mac.

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

- Thread events stay in your Durable Object until the account is deleted. The
  log is append-only — that is what makes multi-device merge trivial — so
  archiving a conversation hides it and deletes nothing; there is no deleting
  one conversation from our cloud.
- A request from your phone, and a permission question sent to it, is kept for a
  day after a Mac settles it, then deleted the next time a request is sent or a
  Mac checks for one. One still waiting stays until a Mac picks it up, you
  cancel it, or you revoke the phone that sent it, which deletes every request
  of its no Mac has picked up yet; revoking a Mac settles every question it
  sent.
- The hosted copies of every account's notes, and every capture still waiting,
  are erased by the first deployment of our cloud without them; nothing of
  either is kept after it.
- Device rows (including revoked ones) persist as the dashboard's audit trail
  until account deletion. A device's throttling counters are deleted when it is
  revoked.
- Throttling rows keyed on an address, not an account, cannot be found by
  account deletion. Better Auth deletes every row whose timestamp is over a
  minute old whenever one of its own limits opens a fresh window, so a row
  outlives its minute only until the next such request from anyone; nothing
  sweeps the table on a timer.
- A password-reset link's row (its token and your account's id) is deleted when
  the link is used. One never used stops working after an hour and is swept the
  next time anyone opens a reset link; account deletion does not look for it,
  and once the account is gone it opens nothing.
- Cloudflare's request log keeps each entry for up to seven days.

**Your phone.** Signed in, the phone keeps its own copy, so it opens your
conversations offline:

- **Your conversations with an agent**, as your Macs sync them.
- **Whatever it has not sent yet.** Requests to your Mac wait on the phone until
  one picks them up.

It all lives in the app's own storage on the phone, which the phone's iCloud
backup includes when you back the phone up to iCloud. The phone's sign-in is
kept in the iPhone's Keychain for that iPhone alone: a backup restored onto
another phone does not carry it, so the new phone signs in again and becomes a
device of its own. An earlier version kept your notes there too; this version
deletes them, and the outbox of edits beside them, the first time it opens.

- **Signing out** on the phone erases all of it — conversations and anything
  unsent, which it asks about first — and tells our cloud to remove the phone
  from your account. A phone that signs out offline forgets its sign-in all the
  same; revoke it from Settings › Account on a Mac.
- **Revoking the phone** from a Mac, or **deleting the account**, erases the
  same the next time the phone reaches our cloud and is refused. Until then it
  keeps what it holds.

## How we share your personal information

We may share your personal information with the following parties (or as
otherwise described in this Privacy Policy, in other applicable notices, or at
the time of collection).

**Service providers.** Third parties that provide services on our behalf or help
us operate the Service or our business (such as hosting, information technology
and email delivery). Specifically:

- **Cloudflare** runs our cloud and our website. Its D1 database holds your
  account, sessions, devices, the invite you redeemed and the throttling rows;
  storage it keeps for your account alone (your own Durable Object) holds your
  thread events and requests; its email sending delivers your password-reset emails; and it keeps the
  request log described above.
- **GitHub** hosts the Mac app's releases and its update feed, and the issues
  you open there.
- **Expo** answers the iPhone app's update check.
- **Apple** delivers the iPhone app through TestFlight.
- **The email services** that receive and forward the email you send us.

**Third parties designated by you.** We may share your personal information with
third parties where you have instructed us or provided your consent to do so.

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

**Privacy settings.** We make available certain privacy settings on the Service,
including options to control whether your phone may ask a Mac (Let my phone ask
this Mac, in Settings › Account), and whether the app's log records each sync
step (Debug logging, in Settings › Advanced). Signing a device
out of your account stops it syncing.

**Cookies and other technologies.** Most browsers let you remove or reject
cookies, and clear what a website keeps in web storage, in their settings. If
you block our website's session cookie, you cannot sign in to its account pages;
the apps do not depend on it. If you clear our website's web storage, it forgets
your theme and shows its dark one.

**Do Not Track.** Some Internet browsers may be configured to send "Do Not
Track" signals to the online services that you visit. We currently do not
respond to "Do Not Track" signals because the Service does not track you across
other websites.

**Declining to provide information.** We need to collect personal information to
provide certain services. If you do not provide the information we identify as
required or mandatory, we may not be able to provide those services. An account
is optional: without one, the Mac app sends our cloud nothing, while syncing your
devices and the iPhone app need one.

**Delete your content or close your account.** You can choose to delete certain
content through your account: archiving a conversation hides it without deleting
it. To delete everything our cloud holds for you,
delete your account in the app: Settings › Account › Delete account…, on any Mac
signed in to it. It asks for your password again, and our cloud checks the
password before it deletes anything, so this Mac's sign-in alone cannot end the
account. If you lost your Mac, sign in on any other and delete from there. The
Mac you delete from is signed out; every other device is refused at its next
request. You can also ask us to close your account by writing to kai@kyh.io from
the account's email address.

Deleting the account deletes the account's data, in this order, before the
account row itself goes:

1. **Every device row you own**, with its throttling counters, is deleted from
   D1. This is first on purpose: while a device row lives its credential still
   works, so any later step could be undone by a request that arrives a moment
   after it.
2. **Your thread-sync Durable Object** is purged whole: every thread event,
   every request from your phone and every permission question,
   every open socket closed. It is then tombstoned, so a request that
   authenticated microseconds before step 1 cannot rebuild what was just
   deleted; it is refused instead.
3. **Your email is dropped from the invite you redeemed** (the code stays
   burned).

Then Better Auth deletes your sessions, your password hash and the account row.
All three steps run BEFORE that, so a step that fails aborts the deletion and
leaves the account able to ask again; every step is idempotent, so asking again
resumes. What deletion does NOT touch is your Mac: the local databases are yours.
Your phone erases its copy the next time it is refused (see
[Retention](#retention)). The throttling rows keyed on an address and an unused
reset link's row are not found by it (see [Retention](#retention)), and
Cloudflare's request log lapses on its own.

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

Everything our cloud keeps for your account, but the throttling rows and
Cloudflare's request log, lands in infrastructure scoped to your account — a
Cloudflare D1 row keyed to your user or your own per-user Durable Object — never
in anything shared across accounts.
Your password and each device credential are kept only as hashes, and the apps
talk to our cloud over HTTPS.

These are the edges of that protection, stated plainly:

- **We can read what our cloud holds.** Thread events and requests are stored
  unencrypted to us (Cloudflare encrypts its storage at rest, but there is no
  end-to-end encryption). Don't sync a conversation you wouldn't store with a
  hosted service.
- **A lost phone holds a full copy of your conversations**, behind its
  passcode. Revoke it from Settings › Account on a Mac: it erases its copy the
  next time it goes online, but a phone that never does keeps it.
- **A revoked device stops at the next request**, and its live connection is
  closed as part of the revoke — but revocation cannot reach a response already
  in flight.
- **Signing out on a device revokes it the same way, but only if our cloud hears
  the sign-out**: a device that signs out offline forgets its credential while
  its row stays active, until you revoke it from Settings › Account on a Mac or
  from the account pages on our website. The desktop's Settings › Account says
  so until it restarts or signs in again.

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
Issues are public, so please leave the contents of your conversations out of
them.

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

| Personal Information ("PI") we collect | CCPA statutory category                                                                                                                         | Purposes                                                                                                    | Categories of third parties to whom we "disclose" PI for a business purpose                                             | Categories of third parties to whom we "sell" or "share" PI |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Contact data                           | Identifiers; California Customer Records                                                                                                        | Service delivery and operations; Compliance and protection; Data sharing in the context of corporate events | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |
| Profile data                           | Identifiers; California Customer Records; Sensitive personal information (your account's login credentials)                                     | Service delivery and operations; Compliance and protection; Data sharing in the context of corporate events | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |
| Communications data                    | Identifiers; California Customer Records; Audio, electronic, visual or similar information (screenshots you send)                               | Service delivery and operations; Compliance and protection; Data sharing in the context of corporate events | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |
| User-generated content and input data  | Any category the content you create holds, such as Identifiers and Audio, electronic, visual or similar information (images in a conversation)  | Service delivery and operations; Compliance and protection; Data sharing in the context of corporate events | Service providers; Third parties designated by you; Professional advisors; Authorities and others; Business transferees | None                                                        |
| Data from service providers            | Identifiers; Internet or other electronic network activity information; Audio, electronic, visual or similar information (screenshots you send) | Service delivery and operations; Compliance and protection                                                  | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |
| Device data                            | Identifiers; Internet or other electronic network activity information                                                                          | Service delivery and operations; Service personalization; Compliance and protection                         | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |
| Online activity data                   | Internet or other electronic network activity information                                                                                       | Service delivery and operations; Compliance and protection                                                  | Service providers; Professional advisors; Authorities and others; Business transferees                                  | None                                                        |

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
membership). Your conversations are yours to write, and if you choose
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
app or the phone makes to it is one of these routes, as is every call the
account pages make but their sign-in, session and password-reset calls, which go
to Better Auth under `/api/auth/`. Nothing else under `/v1/` exists.

| Route                              | What it carries                                                                                                                           | What authenticates it                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `/v1/auth/sign-up`                 | Your email, name, password and invite code, once, to create the account on the website.                                                   | The invite code; attempts are throttled per caller address.         |
| `/v1/device/login`                 | Your email, password and this device's name, once; it answers the device's credential.                                                    | Your password; attempts are throttled per caller address.           |
| `/v1/device/sign-up`               | Your name, email, password, invite code and this Mac's name, once, to create the account from the app.                                    | The invite code; attempts are throttled per caller address.         |
| `/v1/device/sign-out`              | Nothing but the credential; the device it names is removed from your account.                                                             | That device's credential.                                           |
| `/v1/device/list`                  | Your devices' names and when each was created, last seen and revoked, for the account pages and Settings › Account.                       | Your signed-in browser session, or a signed-in device's credential. |
| `/v1/device/revoke`                | The id of the device to revoke.                                                                                                           | Your signed-in browser session, or a signed-in device's credential. |
| `/v1/account`                      | Your account's email and id, answered to a signed-in device.                                                                              | The device's credential.                                            |
| `/v1/account/delete`               | Your password, once, to delete the account and everything this page says the cloud holds for it.                                          | Your password and the device's credential; throttled per device.    |
| `/v1/sync/push`                    | Your conversations with the agent, as events, including what the agent read and changed, with each one's title, agent and archived state. | The device's credential.                                            |
| `/v1/sync/pull`                    | The same events, written by your other devices.                                                                                           | The device's credential.                                            |
| `/v1/sync/ws`                      | A live connection that says only that something changed, and whether a Mac takes your phone's requests.                                   | The device's credential.                                            |
| `/v1/sync/dispatch`                | What you ask your Mac's agent from your phone, or your answer to its permission question.                                                 | The device's credential.                                            |
| `/v1/sync/dispatch/claim`          | The requests waiting for a Mac to pick up, and the answers meant for that Mac.                                                            | The device's credential.                                            |
| `/v1/sync/dispatch/ack`            | The ids of the requests that Mac took, and why it turned one down.                                                                        | The device's credential and the claim it was handed.                |
| `/v1/sync/dispatch/status`         | Whether your requests are waiting, picked up or answered, and how many Macs are online, taking them or not.                               | The device's credential.                                            |
| `/v1/sync/dispatch/cancel`         | The id of a request you took back before a Mac picked it up.                                                                              | The device's credential.                                            |
| `/v1/sync/dispatch/approval`       | The command or change an agent wants your permission for, in a conversation your phone started.                                           | The device's credential.                                            |
| `/v1/sync/dispatch/approval/close` | The id of a permission question that no longer needs your answer.                                                                         | The device's credential.                                            |
| `/v1/sync/dispatch/approvals`      | The permission questions waiting for your answer.                                                                                         | The device's credential.                                            |

Everything else the app reaches is someone else's:

- **GitHub's release feed**, for the desktop's update check described above.
- **Expo's update service**, for the phone's update check described above.

---

This template was prepared and made publicly available by General Legal, PC
("General Legal"). It is provided for general reference purposes only and does
not constitute, and should not be construed as, legal advice, or an endorsement
or review of any particular transaction in which it is used. Use of this
template does not create an attorney-client relationship with General Legal.
General Legal has not reviewed, and takes no position on, any modifications made
to this document or the deal terms it is used to document.
