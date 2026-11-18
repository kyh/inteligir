import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const user = pgTable.withRLS("user", {
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  id: text("id").primaryKey(),
  image: text("image"),
  name: text("name").notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = pgTable.withRLS(
  "session",
  {
    createdAt: timestamp("created_at").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id").primaryKey(),
    ipAddress: text("ip_address"),
    token: text("token").notNull().unique(),
    updatedAt: timestamp("updated_at").notNull(),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable.withRLS(
  "account",
  {
    accessToken: text("access_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    accountId: text("account_id").notNull(),
    createdAt: timestamp("created_at").notNull(),
    id: text("id").primaryKey(),
    idToken: text("id_token"),
    password: text("password"),
    providerId: text("provider_id").notNull(),
    refreshToken: text("refresh_token"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    updatedAt: timestamp("updated_at").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable.withRLS(
  "verification",
  {
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
    value: text("value").notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const rateLimit = pgTable.withRLS("rate_limit", {
  count: integer("count").notNull(),
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const inviteCode = pgTable.withRLS(
  "invite_code",
  {
    code: text("code").primaryKey(),
    redeemedAt: timestamp("redeemed_at"),
    redeemedBy: text("redeemed_by"),
  },
  (table) => [
    check(
      "invite_code_redeemer_check",
      sql`${table.redeemedBy} is null or ${table.redeemedAt} is not null`,
    ),
  ],
);

export const oauthClient = pgTable.withRLS(
  "oauth_client",
  {
    applicationType: text("application_type"),
    backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    clientCredentialsScopes: text("client_credentials_scopes").array().default([]),
    clientDiscoveryId: text("client_discovery_id"),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    contacts: text("contacts").array(),
    createdAt: timestamp("created_at"),
    disabled: boolean("disabled").default(false),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
    enableEndSession: boolean("enable_end_session"),
    grantTypes: text("grant_types").array(),
    icon: text("icon"),
    id: text("id").primaryKey(),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    metadata: jsonb("metadata"),
    name: text("name"),
    policy: text("policy"),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    redirectUris: text("redirect_uris").array().notNull(),
    referenceId: text("reference_id"),
    requirePKCE: boolean("require_pkce"),
    responseTypes: text("response_types").array(),
    scopes: text("scopes").array(),
    skipConsent: boolean("skip_consent"),
    softwareId: text("software_id"),
    softwareStatement: text("software_statement"),
    softwareVersion: text("software_version"),
    subjectType: text("subject_type"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    tos: text("tos"),
    updatedAt: timestamp("updated_at"),
    uri: text("uri"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("oauth_client_userId_idx").on(table.userId)],
);

export const oauthResource = pgTable.withRLS("oauth_resource", {
  accessTokenTtl: integer("access_token_ttl"),
  allowedScopes: text("allowed_scopes").array(),
  createdAt: timestamp("created_at"),
  customClaims: jsonb("custom_claims"),
  disabled: boolean("disabled").default(false),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  metadata: jsonb("metadata"),
  name: text("name").notNull(),
  policyVersion: integer("policy_version").default(1),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  updatedAt: timestamp("updated_at"),
});

export const oauthClientResource = pgTable.withRLS(
  "oauth_client_resource",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at"),
    id: text("id").primaryKey(),
    metadata: jsonb("metadata"),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
  },
  (table) => [
    index("oauth_client_resource_resourceId_idx").on(table.resourceId),
    uniqueIndex("oauth_client_resource_client_resource_uidx").on(table.clientId, table.resourceId),
  ],
);

export const oauthConsent = pgTable.withRLS(
  "oauth_consent",
  {
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at"),
    id: text("id").primaryKey(),
    referenceId: text("reference_id"),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    resources: text("resources").array(),
    scopes: text("scopes").array().notNull(),
    updatedAt: timestamp("updated_at"),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("oauth_consent_clientId_idx").on(table.clientId),
    index("oauth_consent_userId_idx").on(table.userId),
  ],
);

export const oauthRefreshToken = pgTable.withRLS(
  "oauth_refresh_token",
  {
    authTime: timestamp("auth_time"),
    authorizationCodeId: text("authorization_code_id"),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    confirmation: jsonb("confirmation"),
    createdAt: timestamp("created_at"),
    expiresAt: timestamp("expires_at"),
    id: text("id").primaryKey(),
    referenceId: text("reference_id"),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    resources: text("resources").array(),
    revoked: timestamp("revoked"),
    rotatedAt: timestamp("rotated_at"),
    rotationReplayExpiresAt: timestamp("rotation_replay_expires_at"),
    rotationReplayResponse: text("rotation_replay_response"),
    scopes: text("scopes").array().notNull(),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    token: text("token").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("oauth_refresh_token_clientId_idx").on(table.clientId),
    index("oauth_refresh_token_sessionId_idx").on(table.sessionId),
    index("oauth_refresh_token_userId_idx").on(table.userId),
    index("oauth_refresh_token_authorizationCodeId_idx").on(table.authorizationCodeId),
  ],
);

export const oauthAccessToken = pgTable.withRLS(
  "oauth_access_token",
  {
    authorizationCodeId: text("authorization_code_id"),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    confirmation: jsonb("confirmation"),
    createdAt: timestamp("created_at"),
    expiresAt: timestamp("expires_at"),
    id: text("id").primaryKey(),
    referenceId: text("reference_id"),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    resources: text("resources").array(),
    revoked: timestamp("revoked"),
    scopes: text("scopes").array().notNull(),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    token: text("token").unique(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("oauth_access_token_clientId_idx").on(table.clientId),
    index("oauth_access_token_sessionId_idx").on(table.sessionId),
    index("oauth_access_token_userId_idx").on(table.userId),
    index("oauth_access_token_authorizationCodeId_idx").on(table.authorizationCodeId),
    index("oauth_access_token_refreshId_idx").on(table.refreshId),
  ],
);

export const oauthClientAssertion = pgTable.withRLS("oauth_client_assertion", {
  expiresAt: timestamp("expires_at").notNull(),
  id: text("id").primaryKey(),
});
