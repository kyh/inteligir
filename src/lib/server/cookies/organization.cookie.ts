import readServerCookie, {
  AnyCookies,
} from "~/core/generic/read-server-cookie";

const ORGANIZATION_ID_COOKIE_NAME = "organizationId";

export function createOrganizationIdCookie(organizationId: number) {
  const secure = process.env.ENVIRONMENT === "production";

  return {
    name: ORGANIZATION_ID_COOKIE_NAME,
    value: organizationId.toString(),
    httpOnly: false,
    secure,
    path: "/",
    sameSite: "lax" as const,
  };
}

export async function parseOrganizationIdCookie(cookies: AnyCookies) {
  const organizationId = await readServerCookie(
    cookies,
    ORGANIZATION_ID_COOKIE_NAME
  );

  if (Number.isNaN(Number(organizationId)) || organizationId === null) {
    return undefined;
  }

  return organizationId;
}
