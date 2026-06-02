// ---------------------------------------------------------------------------
// Curated catalog of preconfigured connectors surfaced in the Extensions panel.
//
// Each entry is metadata + an install recipe that the ConnectorsSection turns
// into executor calls (addMcpSource / oauthStart / addGoogleSource). This is the
// "app store" of connectors; the "Add custom" escape hatch covers anything not
// listed here.
//
// Remote MCP endpoints are hosted by the respective vendors and can drift —
// they're easy to edit, and the custom flow is the fallback when one is stale.
// ---------------------------------------------------------------------------

/** How a connector authenticates when installed. */
export type ConnectorAuth =
  // OAuth via executor's dynamic client registration (the "connect → browser
  // → done" flow). Works for MCP servers that advertise DCR.
  | { kind: "oauth" }
  // No auth — register the source directly.
  | { kind: "none" }
  // Needs a user-supplied secret (API key / token) passed as a header before
  // the source is registered.
  | { kind: "apiKey"; headerName: string; secretLabel: string; prefix?: string };

/** Install recipe — what executor source we register and how it authenticates. */
export type ConnectorInstall =
  | { type: "mcp"; endpoint: string; auth: ConnectorAuth }
  // Google Workspace — registered as executor google-discovery sources using
  // the bundled OAuth client. Handled by a dedicated code path.
  | { type: "google" };

export type ConnectorCategory =
  | "Development"
  | "Productivity"
  | "Support"
  | "Payments"
  | "AI";

export type CatalogConnector = {
  /** Stable slug — used as the executor namespace and to derive connection ids. */
  id: string;
  name: string;
  description: string;
  category: ConnectorCategory;
  /** Accent color (hex) for the monogram tile. */
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
    install: { type: "mcp", endpoint: "https://api.githubcopilot.com/mcp/", auth: { kind: "oauth" } },
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
    id: "google",
    name: "Google Workspace",
    description: "Gmail, Calendar, Drive, Docs, and Sheets.",
    category: "Productivity",
    accent: "#4285f4",
    install: { type: "google" },
  },
];
