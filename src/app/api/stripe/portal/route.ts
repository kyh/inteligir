import { join } from "path";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { DatabaseClient } from "~/core/db";
import getApiRefererPath from "~/core/generic/get-api-referer-path";
import HttpStatusCode from "~/core/generic/http-status-code.enum";
import { throwNotFoundException } from "~/core/http-exceptions";
import getLogger from "~/core/logger";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { getUserMembershipByOrganization } from "~/lib/memberships/queries";
import { canChangeBilling } from "~/lib/organizations/permissions";
import { getOrganizationByCustomerId } from "~/lib/organizations/queries";
import createBillingPortalSession from "~/lib/stripe/create-billing-portal-session";
import requireSession from "~/lib/user/require-session";

export async function POST(request: Request) {
  const body = Object.fromEntries(await request.formData());

  const bodyResult = await getBodySchema().safeParseAsync(body);
  const referrerPath = getApiRefererPath(headers());

  // Validate the body schema
  if (!bodyResult.success) {
    return redirectToErrorPage(referrerPath);
  }

  const { customerId } = bodyResult.data;

  const client = getSupabaseServerClient();
  const logger = getLogger();
  const session = await requireSession(client);
  const userId = session.user.id;

  // get permissions to see if the user can access the portal
  const canAccess = await getUserCanAccessCustomerPortal(client, {
    customerId,
    userId,
  });

  // validate that the user can access the portal
  if (!canAccess) {
    return redirectToErrorPage(referrerPath);
  }

  try {
    const referer = headers().get("referer");
    const origin = headers().get("origin");
    const returnUrl = referer || origin || "/dashboard";

    // get the Stripe Billing Portal session
    const { url } = await createBillingPortalSession({
      returnUrl,
      customerId,
    });

    // redirect to the Stripe Billing Portal
    return NextResponse.redirect(url, {
      status: HttpStatusCode.SeeOther,
    });
  } catch (error) {
    logger.error(error, `Stripe Billing Portal redirect error`);

    return redirectToErrorPage(referrerPath);
  }
}

async function getUserCanAccessCustomerPortal(
  client: DatabaseClient,
  params: {
    customerId: string;
    userId: string;
  }
) {
  try {
    const { data: organization, error } = await getOrganizationByCustomerId(
      client,
      params.customerId
    );

    if (error) {
      return throwNotFoundException(
        `Organization not found for customer ${params.customerId}`
      );
    }

    const organizationUid = organization.uuid;

    const { role } = await getUserMembershipByOrganization(client, {
      organizationUid,
      userId: params.userId,
    });

    if (role === undefined) {
      return false;
    }

    return canChangeBilling(role);
  } catch (e) {
    getLogger().error(e, `Could not retrieve user role`);

    return false;
  }
}

function getBodySchema() {
  return z.object({
    customerId: z.string().min(1),
  });
}

function redirectToErrorPage(referrerPath: string) {
  const url = join(referrerPath, `?error=true`);

  return redirect(url);
}
