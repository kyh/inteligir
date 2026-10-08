import { siteConfig } from "@/lib/site-config";

// each page's markdown is its one source: the route renders it as HTML and answers it as-is to an
// agent that negotiates text/markdown, so the two representations cannot drift

const { contact, downloadUrl, github, name, url } = siteConfig;

export const homeMarkdown = `# ${name}: an inbox for the coding agents you already run

${name} is being rebuilt. It was a notes app with an AI agent inside; it is becoming an
open-source companion for the coding agents a developer already runs in their own terminals,
Claude Code and Codex first: a Mac app, an iPhone remote and a Linux connector that show at a
glance which agent needs you, and let you answer it, message it, start it and stop it.

## How it will work

- **Your agents stay yours.** ${name} runs no agent of its own and bundles none: it watches the
  ones you already run, on the plans you already pay for, and never routes a model call through
  its own servers.
- **tmux is the control layer.** An agent in a tmux pane can be answered, messaged, stopped and
  started from ${name}; one outside tmux is shown, with a jump to its window.
- **An account is optional.** Without one ${name} stays on your Mac and makes no cloud request.
  With one, your phone and your other machines follow the same agents.

What ships today is the foundation the rebuild grows from, shared with a small invited group on
Macs with Apple silicon.

- [Download for Mac](${downloadUrl})
- [About ${name}](${url}/about)
- [Contact](${url}/contact)
- [Privacy](${url}/privacy)
- [Terms](${url}/terms)
`;

export const aboutMarkdown = `# About ${name}

${name} is an open-source project being rebuilt around one idea: the coding agents a developer
already runs should be easy to keep an eye on, and easy to answer, from wherever the developer
is. It is made for developers who run several agents at once, in their own terminals, on their
own Macs and Linux servers.

## What makes it different

- **No agent of its own.** ${name} watches Claude Code, Codex and the agents that follow; it
  does not resell model access, has no hosted model, and never routes a model call through its
  own servers.
- **tmux as the control layer.** Answering, messaging, stopping and starting an agent happen in
  its tmux pane, through keystrokes ${name} checks against what the pane shows before it sends
  them.
- **Speech on the device.** Talking to your agents will run on your Mac, with nothing sent to
  a speech service.
- **A relay, not a brain.** An optional account carries your agents' state between your Mac,
  your phone and your servers; nothing runs in the cloud but the relay.

## Who makes it

${name} is an independent, open-source project by Kaiyu Hsu, released under the MIT license. The
source code, the release notes and the issue tracker all live on
[GitHub](${github}). It is currently shared with a small invited group on Macs with Apple
silicon while it is rebuilt.

Read the [privacy policy](${url}/privacy) for exactly what leaves your Mac, or
[get in touch](${url}/contact).
`;

export const contactMarkdown = `# Contact ${name}

${name} is an independent project by Kaiyu Hsu. Here is how to reach him.

## Email

Write to [${contact.email}](mailto:${contact.email}) for anything: questions about the app, an
invite for yourself or your team, feedback, a privacy request, or deleting your account and its
data.

## GitHub

Bugs and feature requests are best filed as
[issues on GitHub](${github}/issues), where you can also follow what is being worked on and read
the source. Please leave the contents of your conversations out of a public issue.

## Elsewhere

Updates are posted on X as [${siteConfig.twitter}](${siteConfig.twitterUrl}).

## Before you write

- **Can't sign in or forgot your password?** The sign-in page can email you a reset link.
- **Want to remove your data?** Deleting your account from the app's settings deletes what the
  cloud holds for it; the [privacy policy](${url}/privacy) explains exactly what that covers.
`;

export const llmsTxt = `# ${name}

> ${name} is an open-source companion, being rebuilt, for the coding agents a developer already
> runs in their own terminals: it shows which one needs attention and lets the developer answer,
> message, start and stop it, with tmux as the control layer.

${name} runs no agent and no model of its own: it watches agents such as Claude Code and Codex
that the developer runs on their own plans. It is a Mac app with an iPhone remote and a Linux
connector; an optional account relays state between them. It is open source (MIT), available
for Apple silicon Macs, and shared with a small invited group while it is rebuilt.

## When to use ${name}

- A developer runs several coding agents at once and wants to see which one is waiting on them.
- A developer wants to answer an agent's question or approval from another device.
- A developer wants a tool that uses the agents and plans they already have, not a new
  subscription or API key.

## When not to use ${name}

- The person wants an AI agent hosted for them, or a notes app.
- The person is on Windows or an Intel Mac.

## Pages

- [Home](${url}/): what ${name} is and how it works
- [About](${url}/about): principles and who makes it
- [Contact](${url}/contact): email and GitHub
- [Privacy Policy](${url}/privacy): exactly what leaves the user's Mac and what never does
- [Terms of Use](${url}/terms): the terms for using the site and the apps

## Optional

- [Download](${downloadUrl}): the signed macOS build
- [Source code](${github}): the open-source repository
- [Sitemap](${url}/sitemap.xml)
`;

export const notFoundMarkdown = (path: string): string => `# Page not found

Nothing is served at \`${path}\` on ${url}.

- [Home](${url}/)
- [llms.txt](${url}/llms.txt): a summary of ${name} for agents
- [Sitemap](${url}/sitemap.xml): every page on this site
`;

export const SITEMAP_PATHS = ["/", "/about", "/contact", "/privacy", "/terms"] as const;
