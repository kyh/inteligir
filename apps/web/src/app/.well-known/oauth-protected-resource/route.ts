// The connector's protected resource metadata (RFC 9728): where an assistant learns which
// authorization server to sign in with, and which scopes there are. The root form and the
// `/connector` path form serve the same document.
export {
  discoveryPreflightResponse as OPTIONS,
  protectedResourceMetadataResponse as GET,
} from "@repo/service/auth/oauth-discovery";
