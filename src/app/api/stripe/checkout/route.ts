import { z } from "zod";
import { join } from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";

import getLogger from "~/core/logger";
import HttpStatusCode from "~/core/generic/http-status-code.enum";
import getApiRefererPath from "~/core/generic/get-api-referer-path";

import createStripeCheckout from "~/lib/stripe/create-checkout";
import { canChangeBilling } from "~/lib/organizations/permissions";
import { parseOrganizationIdCookie } from "~/lib/server/cookies/organization.cookie";
import { getUserMembershipByOrganization } from "~/lib/memberships/queries";
import requireSession from "~/lib/user/require-session";
import getSupabaseServerClient from "~/core/supabase/server-client";
import configuration from "~/configuration";

export async function POST(request: Request) {
  const logger = getLogger();
  const body = Object.fromEntries(await request.formData());
  const bodyResult = await getBodySchema().safeParseAsync(body);

  const redirectToErrorPage = (error?: string) => {
    const referer = getApiRefererPath(headers());
    const url = join(referer, `?error=true`);

    logger.error({ error }, `Could not create Stripe Checkout session`);

    return redirect(url);
  };

  // Validate the body schema
  if (!bodyResult.success) {
    return redirectToErrorPage(`Invalid request body`);
  }

  const { organizationId, priceId, customerId, returnUrl } = bodyResult.data;

  // create the Supabase client
  const client = getSupabaseServerClient();

  // require the user to be logged in
  const sessionResult = await requireSession(client);

  if ("redirect" in sessionResult) {
    return redirect(sessionResult.destination);
  }

  const userId = sessionResult.user.id;

  const currentOrganizationId = Number(
    await parseOrganizationIdCookie(cookies())
  );

  const matchesSessionOrganizationId = currentOrganizationId === organizationId;

  // check if the organization ID in the cookie matches the one in the request
  if (!matchesSessionOrganizationId) {
    return redirectToErrorPage(`Conflicting Organizations`);
  }

  const plan = getPlanByPriceId(priceId);

  // check if the plan exists in the configuration.
  if (!plan) {
    console.warn(
      `Plan not found for price ID "${priceId}". Did you forget to add it to the configuration? If the Price ID is incorrect, the checkout will be rejected. Please check the Stripe dashboard`
    );
  }

  // check the user's role has access to the checkout
  const canChangeBilling = await getUserCanAccessCheckout(client, {
    organizationId,
    userId,
  });

  // disallow if the user doesn't have permissions to change
  // billing settings based on its role. To change the logic, please update
  // {@link canChangeBilling}
  if (!canChangeBilling) {
    logger.debug(
      {
        userId,
        organizationId,
      },
      `User attempted to access checkout but lacked permissions`
    );

    return redirectToErrorPage(
      `You do not have permission to access this page`
    );
  }

  try {
    const trialPeriodDays =
      plan && "trialPeriodDays" in plan
        ? (plan.trialPeriodDays as number)
        : undefined;

    // create the Stripe Checkout session
    const { url } = await createStripeCheckout({
      returnUrl,
      organizationId,
      priceId,
      customerId,
      trialPeriodDays,
    });

    // retrieve the Checkout Portal URL
    const portalUrl = getCheckoutPortalUrl(url, returnUrl);

    // redirect user back based on the response
    return NextResponse.redirect(portalUrl, {
      status: HttpStatusCode.SeeOther,
    });
  } catch (e) {
    logger.error(e, `Stripe Checkout error`);

    return redirectToErrorPage(`An unexpected error occurred`);
  }
}

/**
 * @name getUserCanAccessCheckout
 * @description check if the user has permissions to access the checkout
 * @param client
 * @param params
 */
async function getUserCanAccessCheckout(
  client: SupabaseClient,
  params: {
    organizationId: number;
    userId: string;
  }
) {
  try {
    const { role } = await getUserMembershipByOrganization(client, params);

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
    csrf_token: z.string().min(1),
    organizationId: z
      .number({
        coerce: true,
      })
      .min(1),
    priceId: z.string().min(1),
    customerId: z.string().optional(),
    returnUrl: z.string().min(1),
  });
}

function getPlanByPriceId(priceId: string) {
  const products = configuration.stripe.products;

  type Plan = (typeof products)[0]["plans"][0];

  return products.reduce<Maybe<Plan>>((acc, product) => {
    if (acc) {
      return acc;
    }

    return product.plans.find(({ stripePriceId }) => stripePriceId === priceId);
  }, undefined);
}

/**
 *
 * @param portalUrl
 * @param returnUrl
 * @description return the URL of the Checkout Portal
 * if running in emulator mode and the portal URL is undefined (as
 * stripe-mock does) then return the returnUrl (i.e. it redirects back to
 * the subscriptions page)
 */
function getCheckoutPortalUrl(portalUrl: string | null, returnUrl: string) {
  if (isTestingMode() && !portalUrl) {
    return [returnUrl, "success=true"].join("?");
  }

  return portalUrl as string;
}

/**
 * @description detect if Stripe is running in emulator mode
 */
function isTestingMode() {
  const enableStripeTesting = process.env.ENABLE_STRIPE_TESTING;

  return enableStripeTesting === "true";
}
