import { cookies } from "next/headers";

const ORGANIZATION_ID_COOKIE_NAME = "organizationId";

export const createOrganizationIdCookie = (params: {
  userId: string;
  organizationUid: string;
}) => {
  const secure = process.env.ENVIRONMENT === "production";

  return {
    name: buildOrganizationIdCookieName(params.userId),
    value: params.organizationUid,
    httpOnly: false,
    secure,
    path: "/",
    sameSite: "lax" as const,
  };
};

export const parseOrganizationIdCookie = async (userId: string) => {
  const cookie = cookies().get(buildOrganizationIdCookieName(userId));

  return cookie?.value;
};

const buildOrganizationIdCookieName = (userId: string) => `${userId}-${ORGANIZATION_ID_COOKIE_NAME}`;
