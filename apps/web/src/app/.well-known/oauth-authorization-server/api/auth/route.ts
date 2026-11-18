// The authorization server's metadata (RFC 8414) at the path-inserted well-known URL of the issuer
// `<origin>/api/auth`.
export {
  authorizationServerMetadataResponse as GET,
  discoveryPreflightResponse as OPTIONS,
} from "@repo/service/auth/oauth-discovery";
