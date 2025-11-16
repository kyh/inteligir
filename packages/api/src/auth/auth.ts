import type { User } from "better-auth";
import { cache } from "react";
import { headers } from "next/headers";
import { expo } from "@better-auth/expo";
import { db } from "@repo/db/drizzle-client";
import { user as userSchema } from "@repo/db/drizzle-schema-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, oAuthProxy, organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { slugify } from "./utils";

const baseUrl =
  process.env.VERCEL_ENV === "production"
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_ENV === "preview"
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

const generateAvailableUsername = async (slug: string, attempt = 0): Promise<string> => {
  const candidate = attempt === 0 ? slug : `${slug}${attempt + 1}`;

  const existing = await db.query.user.findFirst({
    where: (u, { eq }) => eq(u.username, candidate),
  });

  if (existing) {
    return generateAvailableUsername(slug, attempt + 1);
  }

  return candidate;
};

const ensureUsername = async (user: User) => {
  const base = slugify(
    user.name ??
      user.email ??
      `user-${Math.random().toString(36).slice(2, 8)}`,
  );

  const username = await generateAvailableUsername(base);

  await db
    .update(userSchema)
    .set({ username })
    .where(eq(userSchema.id, user.id));
};

export const auth: ReturnType<typeof betterAuth> = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  baseURL: baseUrl,
  secret: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  plugins: [
    oAuthProxy({
      currentURL: baseUrl,
      productionURL: `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "init.kyh.io"}`,
    }),
    expo(),
    organization(),
    admin(),
  ],
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      redirectURI: `${baseUrl}/api/auth/callback/github`,
    },
  },
  trustedOrigins: ["expo://"],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensureUsername(user);
          await createDefaultOrganization(user);
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          return await setActiveOrganization(session);
        },
      },
    },
  },
});

export type Auth = typeof auth;
export type Session = Auth["$Infer"]["Session"];

/**
 * Cached function to get the current user session
 * Uses React cache to avoid unnecessary re-fetching
 * @returns Promise<Session | null> - The current user session or null if not authenticated
 */
export const getSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

export const getOrganization = cache(
  async (query: {
    organizationId?: string | undefined;
    organizationSlug?: string | undefined;
    membersLimit?: string | number | undefined;
  }) =>
    (auth.api as any).getFullOrganization({
      query,
      headers: await headers(),
    }),
);

/**
 * Creates a default personal organization for a new user
 * Generates a unique slug and creates the organization
 * If organization creation fails, the user is deleted to maintain data consistency
 * @param user - The user object for whom to create the organization
 * @throws Error if organization creation fails
 */
const createDefaultOrganization = async (user: User) => {
  /**
   * Generates an available organization slug by checking for conflicts
   * Recursively adds numbers to the slug until a unique one is found
   * @param slug - The base slug to check
   * @param attempt - The current attempt number for uniqueness
   * @returns Promise<string> - A unique, available slug
   */
  const generateAvailableSlug = async (slug: string, attempt = 0) => {
    const org = await db.query.organization.findFirst({
      where: (organization, { eq }) => eq(organization.slug, slug),
    });
    if (org) {
      return generateAvailableSlug(slug + `-${attempt + 1}`, attempt + 1);
    }
    return slug;
  };

  const slug = await generateAvailableSlug(slugify(user.name));

  try {
    await (auth.api as any).createOrganization({
      body: {
        userId: user.id,
        name: "Personal Organization",
        slug,
        metadata: {
          personal: true,
        },
      },
    });
  } catch (err) {
    // If organization creation fails, delete the user to maintain data consistency
    await db.delete(userSchema).where(eq(userSchema.id, user.id));
    throw err;
  }
};

/**
 * Sets the active organization for a user session
 * Finds the first organization the user is a member of and sets it as active
 * @param session - The session object containing the user ID
 * @returns Promise<object> - Session data with activeOrganizationId set
 */
const setActiveOrganization = async (session: { userId: string }) => {
  const firstOrg = await db.query.member.findFirst({
    where: (member, { eq }) => eq(member.userId, session.userId),
  });

  return {
    data: {
      ...session,
      activeOrganizationId: firstOrg?.organizationId,
    },
  };
};
