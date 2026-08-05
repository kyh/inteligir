// ---------------------------------------------------------------------------
// Curated catalog of preconfigured connectors surfaced in the Extensions panel.
//
// Each entry is metadata + an install recipe that catalogInstallRequest maps
// to ONE host-orchestrated `installConnector` Bridge request (the server owns
// the register-integration + mint-connection + OAuth sequence). This is the
// "app store" of connectors; the "Add custom" escape hatch covers anything
// not listed here.
//
// Remote MCP endpoints are hosted by the respective vendors and can drift —
// they're easy to edit, and the custom flow is the fallback when one is stale.
// ---------------------------------------------------------------------------

import type { ConnectorInstallRequest, ConnectorSourceSpec } from "@repo/bridge/executor";

/** How a connector authenticates when installed. */
type ConnectorAuth =
  // OAuth via executor's dynamic client registration (the "connect → browser
  // → done" flow). Works for MCP servers that advertise DCR.
  | { kind: "oauth" }
  // No credential — a `none`-template connection is still created so the
  // integration's tools are addressable.
  | { kind: "none" }
  // Needs a user-supplied secret (API key / token) rendered as a header by
  // the connection's credential.
  | { kind: "apiKey"; headerName: string; secretLabel: string; prefix?: string };

/** Install recipe — what executor integration we register and how it authenticates. */
type ConnectorInstall =
  | { type: "mcp"; endpoint: string; auth: ConnectorAuth }
  // Google Workspace services — registered as an openapi googleDiscoveryBundle
  // integration from the service's Discovery doc. The OAuth consent runs in
  // the browser at connect time, against the user's own GCP OAuth client
  // (collected once, shared by every Google connector).
  | { type: "google"; discoveryUrl: string };

export type ConnectorCategory = "Development" | "Productivity" | "Support" | "Payments" | "AI";

export type CatalogConnector = {
  /** Stable slug — used as the executor integration slug (the first segment of
   * every tool address, baked into the seed dashboard widgets). */
  id: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  /** Accent color (hex) for the brand-logo tile. */
  accent: string;
  install: ConnectorInstall;
};

export const CONNECTOR_CATALOG: CatalogConnector[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repos, issues, pull requests, and Actions.",
    category: "Development",
    accent: "#24292f",
    install: {
      type: "mcp",
      endpoint: "https://api.githubcopilot.com/mcp/",
      auth: { kind: "oauth" },
    },
  },
  {
    id: "linear",
    name: "Linear",
    description: "Issues, projects, and cycles.",
    category: "Productivity",
    accent: "#5e6ad2",
    install: { type: "mcp", endpoint: "https://mcp.linear.app/sse", auth: { kind: "oauth" } },
  },
  {
    id: "notion",
    name: "Notion",
    description: "Search and edit pages and databases.",
    category: "Productivity",
    accent: "#000000",
    install: { type: "mcp", endpoint: "https://mcp.notion.com/mcp", auth: { kind: "oauth" } },
  },
  {
    id: "sentry",
    name: "Sentry",
    description: "Errors, issues, and performance.",
    category: "Development",
    accent: "#362d59",
    install: { type: "mcp", endpoint: "https://mcp.sentry.dev/mcp", auth: { kind: "oauth" } },
  },
  {
    id: "atlassian",
    name: "Atlassian",
    description: "Jira issues and Confluence pages.",
    category: "Productivity",
    accent: "#0052cc",
    install: { type: "mcp", endpoint: "https://mcp.atlassian.com/v1/sse", auth: { kind: "oauth" } },
  },
  {
    id: "asana",
    name: "Asana",
    description: "Tasks, projects, and workspaces.",
    category: "Productivity",
    accent: "#f06a6a",
    install: { type: "mcp", endpoint: "https://mcp.asana.com/sse", auth: { kind: "oauth" } },
  },
  {
    id: "intercom",
    name: "Intercom",
    description: "Conversations and help-desk data.",
    category: "Support",
    accent: "#1f8ded",
    install: { type: "mcp", endpoint: "https://mcp.intercom.com/sse", auth: { kind: "oauth" } },
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Payments, customers, and invoices.",
    category: "Payments",
    accent: "#635bff",
    install: { type: "mcp", endpoint: "https://mcp.stripe.com", auth: { kind: "oauth" } },
  },
  {
    id: "paypal",
    name: "PayPal",
    description: "Orders, payments, and disputes.",
    category: "Payments",
    accent: "#003087",
    install: { type: "mcp", endpoint: "https://mcp.paypal.com/sse", auth: { kind: "oauth" } },
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    description: "Workers, DNS, and observability.",
    category: "Development",
    accent: "#f48120",
    install: {
      type: "mcp",
      endpoint: "https://observability.mcp.cloudflare.com/sse",
      auth: { kind: "oauth" },
    },
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    description: "Models, datasets, and Spaces.",
    category: "AI",
    accent: "#ff9d00",
    install: {
      type: "mcp",
      endpoint: "https://huggingface.co/mcp",
      auth: {
        kind: "apiKey",
        headerName: "Authorization",
        secretLabel: "Hugging Face access token",
        prefix: "Bearer ",
      },
    },
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read, search, and send email.",
    category: "Productivity",
    accent: "#ea4335",
    install: {
      type: "google",
      discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest",
    },
  },
  {
    id: "google_calendar",
    name: "Google Calendar",
    description: "Events, agendas, and scheduling.",
    category: "Productivity",
    accent: "#4285f4",
    install: {
      type: "google",
      discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
    },
  },
  {
    id: "google_drive",
    name: "Google Drive",
    description: "Browse, search, and manage files.",
    category: "Productivity",
    accent: "#1da462",
    install: {
      type: "google",
      discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest",
    },
  },
  {
    id: "google_docs",
    name: "Google Docs",
    description: "Read and edit documents.",
    category: "Productivity",
    accent: "#4285f4",
    install: {
      type: "google",
      discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/docs/v1/rest",
    },
  },
  {
    id: "google_sheets",
    name: "Google Sheets",
    description: "Read and write spreadsheets.",
    category: "Productivity",
    accent: "#0f9d58",
    install: {
      type: "google",
      discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/sheets/v4/rest",
    },
  },
  {
    id: "google_contacts",
    name: "Google Contacts",
    description: "Find people, recent contacts, and email aliases.",
    category: "Productivity",
    accent: "#4285f4",
    install: {
      type: "google",
      discoveryUrl: "https://www.googleapis.com/discovery/v1/apis/people/v1/rest",
    },
  },
];

/** Display order for the category sections in the connectors grid. */
const CATEGORY_ORDER: ConnectorCategory[] = [
  "Development",
  "Productivity",
  "AI",
  "Support",
  "Payments",
];

/** Catalog grouped by category (in display order), skipping empty groups. */
export const CONNECTOR_GROUPS: { category: ConnectorCategory; connectors: CatalogConnector[] }[] =
  CATEGORY_ORDER.map((category) => ({
    category,
    connectors: CONNECTOR_CATALOG.filter((c) => c.category === category),
  })).filter((group) => group.connectors.length > 0);

/** Map a catalog connector to an install request (secret value supplied for
 * API-key connectors) for the host-orchestrated `installConnector` channel. */
export function catalogInstallRequest(
  connector: CatalogConnector,
  secretValue?: string,
): ConnectorInstallRequest {
  const { install } = connector;
  if (install.type === "google") {
    return {
      source: {
        type: "google",
        slug: connector.id,
        name: connector.name,
        discoveryUrl: install.discoveryUrl,
      },
      auth: { kind: "google" },
    };
  }
  const source: ConnectorSourceSpec = {
    type: "mcp",
    slug: connector.id,
    name: connector.name,
    endpoint: install.endpoint,
  };
  const auth = install.auth;
  if (auth.kind === "apiKey") {
    if (!secretValue) {
      throw new Error("An API-key connector requires a secret value.");
    }
    return {
      source,
      auth: {
        kind: "apiKey",
        headerName: auth.headerName,
        ...(auth.prefix === undefined ? {} : { prefix: auth.prefix }),
        value: secretValue,
      },
    };
  }
  return { source, auth: auth.kind === "oauth" ? { kind: "oauth" } : { kind: "none" } };
}
