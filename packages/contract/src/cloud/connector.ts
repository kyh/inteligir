// Where a person's own assistant reaches their library: the connector, an MCP server Claude and
// ChatGPT add by this address under the Worker's origin, signed in with OAuth on the site's own
// consent page. The address is the protected resource every token the connector accepts is minted
// for (RFC 8707), so it never moves.
export const CONNECTOR_PATH = "/connector";
