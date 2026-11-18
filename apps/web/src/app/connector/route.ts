// The connector a person adds to their assistant, which signs in by OAuth and calls the library's
// tools. GET and DELETE are its own to refuse, after the challenge an assistant signs in from.
export {
  handleConnectorRequest as DELETE,
  handleConnectorRequest as GET,
  handleConnectorRequest as POST,
} from "@repo/service/mcp/connector-server";
