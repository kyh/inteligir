"use server";

import { join } from "path";
import { RedirectType } from "next/dist/client/components/redirect";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { siteConfig } from "~/config/site";
import { z } from "zod";
import getApiRefererPath from "~/core/generic/get-api-referer-path";
import { throwNotFoundException } from "~/core/http-exceptions";
import getLogger from "~/core/logger";
import getSupabaseServerClient from "~/core/supabase/server-client";
import { getUserMembershipByOrganization } from "~/lib/memberships/queries";
import { canChangeBilling } from "~/lib/organizations/permissions";
import {
  getOrganizationByCustomerId,
  getOrganizationByUid,
} from "~/lib/organizations/queries";
import createBillingPortalSession from "~/lib/stripe/create-billing-portal-session";
import createStripeCheckout from "~/lib/stripe/create-checkout";
import requireSession from "~/lib/user/require-session";

export async function createCheckoutAction(formData: FormData) {
  const logger = getLogger();
  const body = Object.fromEntries(formData);
  const bodyResult = await getCheckoutBodySchema().safeParseAsync(body);

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

  const { organizationUid, priceId, customerId, returnUrl } = bodyResult.data;

  // create the Supabase client
  const client = getSupabaseServerClient();

  // require the user to be logged in
  const sessionResult = await requireSession(client);
  const userId = sessionResult.user.id;

  const { error } = await getOrganizationByUid(client, organizationUid);

  if (error) {
    return redirectToErrorPage(`Organization not found`);
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
    organizationUid,
    userId,
  });

  // disallow if the user doesn't have permissions to change
  // billing settings based on its role. To change the logic, please update
  // {@link canChangeBilling}
  if (!canChangeBilling) {
    logger.debug(
      {
        userId,
        organizationUid,
      },
      `User attempted to access checkout but lacked permissions`
    );

    return redirectToErrorPage(
      `You do not have permission to access this page`
    );
  }

  const trialPeriodDays =
    plan && "trialPeriodDays" in plan
      ? (plan.trialPeriodDays as number)
      : undefined;

  // create the Stripe Checkout session
  const { url } = await createStripeCheckout({
    returnUrl,
    organizationUid,
    priceId,
    customerId,
    trialPeriodDays,
  }).catch((e) => {
    logger.error(e, `Stripe Checkout error`);

    return redirectToErrorPage(`An unexpected error occurred`);
  });

  // retrieve the Checkout Portal URL
  const portalUrl = getCheckoutPortalUrl(url, returnUrl);

  // redirect user back based on the response
  return redirect(portalUrl, RedirectType.replace);
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
    organizationUid: string;
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

export async function createBillingPortalSessionAction(formData: FormData) {
  const body = Object.fromEntries(formData);
  const bodyResult = await getBillingPortalBodySchema().safeParseAsync(body);
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

  const referer = headers().get("referer");
  const origin = headers().get("origin");
  const returnUrl = referer || origin || "/dashboard";

  // get the Stripe Billing Portal session
  const { url } = await createBillingPortalSession({
    returnUrl,
    customerId,
  }).catch((e) => {
    logger.error(e, `Stripe Billing Portal redirect error`);

    return redirectToErrorPage(referrerPath);
  });

  // redirect to the Stripe Billing Portal
  return redirect(url, RedirectType.replace);
}

/**
 * @name getUserCanAccessCustomerPortal
 * @description Returns whether a user {@link userId} has access to the
 * Stripe portal of an organization with customer ID {@link customerId}
 */
async function getUserCanAccessCustomerPortal(
  client: SupabaseClient,
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

function getBillingPortalBodySchema() {
  return z.object({
    customerId: z.string().min(1),
  });
}

function getCheckoutBodySchema() {
  return z.object({
    csrf_token: z.string().min(1),
    organizationUid: z.string().uuid(),
    priceId: z.string().min(1),
    customerId: z.string().optional(),
    returnUrl: z.string().min(1),
  });
}

function getPlanByPriceId(priceId: string) {
  const products = siteConfig.stripe.products;

  type Plan = (typeof products)[0]["plans"][0];

  return products.reduce<Maybe<Plan>>((acc, product) => {
    if (acc) {
      return acc;
    }

    return product.plans.find(({ stripePriceId }) => stripePriceId === priceId);
  }, undefined);
}

function getCheckoutPortalUrl(portalUrl: string | null, returnUrl: string) {
  if (isTestingMode() && !portalUrl) {
    return [returnUrl, "success=true"].join("?");
  }

  return portalUrl as string;
}

function isTestingMode() {
  const enableStripeTesting = process.env.ENABLE_STRIPE_TESTING;

  return enableStripeTesting === "true";
}

function redirectToErrorPage(referrerPath: string) {
  const url = join(referrerPath, `?error=true`);

  return redirect(url);
}
