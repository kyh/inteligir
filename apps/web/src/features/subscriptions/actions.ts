"use server";

import { join } from "node:path";
import { z } from "zod";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { RedirectType } from "next/dist/client/components/redirect";
import type { SupabaseClient } from "@/lib/supabase/client";
import getApiRefererPath from "@/lib/utils/get-api-referer-path";
import createStripeCheckout from "@/features/subscriptions/create-checkout";
import { canChangeBilling } from "@/features/organizations/permissions";
import { getUserMembershipByOrganization } from "@/features/memberships/queries";
import { requireSession } from "@/features/auth/require-session";
import { getSupabaseServerClient } from "@/lib/supabase/server-client";
import { createBillingPortalSession } from "@/features/subscriptions/create-billing-portal-session";
import { withSession } from "@/lib/utils/actions-utils";
import { getLogger } from "@/lib/utils/logger";
import {
  getOrganizationByCustomerId,
  getOrganizationByUid,
} from "@/features/organizations/queries";
import { verifyCsrfToken } from "@/lib/csrf/verify-csrf-token";

export const createCheckoutAction = withSession(async (formData: FormData) => {
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

  const { organizationUid, priceId, customerId, returnUrl, csrfToken } =
    bodyResult.data;

  // check CSRF token is valid
  await verifyCsrfToken(csrfToken);

  // create the Supabase client
  const client = getSupabaseServerClient();

  // require the user to be logged in
  const sessionResult = await requireSession(client);
  const userId = sessionResult.user.id;
  const customerEmail = sessionResult.user.email;

  const { error } = await getOrganizationByUid(client, organizationUid);

  if (error) {
    return redirectToErrorPage(`Organization not found`);
  }

  const plan = getPlanByPriceId(priceId);

  // check if the plan exists in the configuration.
  if (!plan) {
    console.warn(
      `Plan not found for price ID "${priceId}". Did you forget to add it to the configuration? If the Price ID is incorrect, the checkout will be rejected. Please check the Stripe dashboard`,
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
      `User attempted to access checkout but lacked permissions`,
    );

    return redirectToErrorPage(
      `You do not have permission to access this page`,
    );
  }

  const trialPeriodDays =
    plan && "trialPeriodDays" in plan
      ? (plan.trialPeriodDays as number)
      : undefined;

  // create the Stripe Checkout session
  const response = await createStripeCheckout({
    returnUrl,
    organizationUid,
    priceId,
    customerId,
    trialPeriodDays,
    customerEmail,
  }).catch((e) => {
    logger.error(e, `Stripe Checkout error`);
  });

  // if there was an error, redirect to the error page
  if (!response) {
    return redirectToErrorPage();
  }

  // retrieve the Checkout Portal URL
  const portalUrl = getCheckoutPortalUrl(response.url, returnUrl);

  // redirect user back based on the response
  return redirect(portalUrl, RedirectType.replace);
});

/**
 * @name getUserCanAccessCheckout
 * @description check if the user has permissions to access the checkout
 * @param client
 * @param params
 */
const getUserCanAccessCheckout = async (
  client: SupabaseClient,
  params: {
    organizationUid: string;
    userId: string;
  },
) => {
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
};

export const createBillingPortalSessionAction = withSession(
  async (formData: FormData) => {
    const body = Object.fromEntries(formData);
    const bodyResult = await getBillingPortalBodySchema().safeParseAsync(body);
    const referrerPath = getApiRefererPath(headers());

    // Validate the body schema
    if (!bodyResult.success) {
      return redirectToErrorPage(referrerPath);
    }

    const { customerId, csrfToken } = bodyResult.data;

    await verifyCsrfToken(csrfToken);

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
  },
);

/**
 * @name getUserCanAccessCustomerPortal
 * @description Returns whether a user {@link userId} has access to the
 * Stripe portal of an organization with customer ID {@link customerId}
 */
const getUserCanAccessCustomerPortal = async (
  client: SupabaseClient,
  params: {
    customerId: string;
    userId: string;
  },
) => {
  const logger = getLogger();

  const { data: organization, error } = await getOrganizationByCustomerId(
    client,
    params.customerId,
  );

  if (error) {
    logger.error(
      {
        error,
        customerId: params.customerId,
      },
      `Could not retrieve organization by Customer ID`,
    );

    return false;
  }

  try {
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
    logger.error(e, `Could not retrieve user role`);

    return false;
  }
};

const getBillingPortalBodySchema = () =>
  z.object({
    customerId: z.string().min(1),
    csrfToken: z.string().min(1),
  });

const getCheckoutBodySchema = () =>
  z.object({
    csrfToken: z.string().min(1),
    organizationUid: z.string().uuid(),
    priceId: z.string().min(1),
    customerId: z.string().optional(),
    returnUrl: z.string().min(1),
  });

const getPlanByPriceId = (priceId: string) => {
  const products = configuration.stripe.products;

  type Plan = (typeof products)[0]["plans"][0];

  return products.reduce<Maybe<Plan>>((acc, product) => {
    if (acc) {
      return acc;
    }

    return product.plans.find(({ stripePriceId }) => stripePriceId === priceId);
  }, undefined);
};

/**
 *
 * @param portalUrl
 * @param returnUrl
 * @description return the URL of the Checkout Portal
 * if running in emulator mode and the portal URL is undefined (as
 * stripe-mock does) then return the returnUrl (i.e. it redirects back to
 * the subscriptions page)
 */
const getCheckoutPortalUrl = (portalUrl: string | null, returnUrl: string) => {
  if (isTestingMode() && !portalUrl) {
    return [returnUrl, "success=true"].join("?");
  }

  return portalUrl!;
};

/**
 * @description detect if Stripe is running in emulator mode
 */
const isTestingMode = () => {
  const enableStripeTesting = process.env.ENABLE_STRIPE_TESTING;

  return enableStripeTesting === "true";
};

const redirectToErrorPage = (referrerPath: string) => {
  const url = join(referrerPath, `?error=true`);

  return redirect(url);
};
