import type { Stripe } from "stripe";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@/lib/supabase/client";
import getStripeInstance from "@/features/subscriptions/get-stripe";
import StripeWebhooks from "@/features/subscriptions/stripe-webhooks.enum";
import {
  addSubscription,
  deleteSubscription,
  updateSubscriptionById,
} from "@/features/subscriptions/mutations";
import getSupabaseServerClient from "@/lib/supabase/server-client";
import { setOrganizationSubscriptionData } from "@/lib/organizations/database/mutations";
import {
  throwBadRequestException,
  throwInternalServerErrorException,
} from "@/core/http-exceptions";
import getLogger from "@/core/logger";

const STRIPE_SIGNATURE_HEADER = "stripe-signature";

const webhookSecretKey = process.env.STRIPE_WEBHOOK_SECRET!;

/**
 * @description Handle the webhooks from Stripe related to checkouts
 */
export const POST = async (request: Request) => {
  const logger = getLogger();
  const signature = headers().get(STRIPE_SIGNATURE_HEADER);

  logger.info(`[Stripe] Received Stripe Webhook`);

  if (!webhookSecretKey) {
    return throwInternalServerErrorException(
      `The variable STRIPE_WEBHOOK_SECRET is unset. Please add the STRIPE_WEBHOOK_SECRET environment variable`,
    );
  }

  // verify signature header is not missing
  if (!signature) {
    return throwBadRequestException();
  }

  const rawBody = await request.text();
  const stripe = await getStripeInstance();

  // create an Admin client to write to the subscriptions table
  const client = getSupabaseServerClient({
    admin: true,
  });

  try {
    // build the event from the raw body and signature using Stripe
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecretKey,
    );

    logger.info(
      {
        type: event.type,
      },
      `[Stripe] Processing Stripe Webhook...`,
    );

    switch (event.type) {
      case StripeWebhooks.Completed: {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = session.subscription as string;

        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);

        await onCheckoutCompleted(client, session, subscription);

        break;
      }

      case StripeWebhooks.SubscriptionDeleted: {
        const subscription = event.data.object as Stripe.Subscription;

        await deleteSubscription(client, subscription.id);

        break;
      }

      case StripeWebhooks.SubscriptionUpdated: {
        const subscription = event.data.object as Stripe.Subscription;

        await updateSubscriptionById(client, subscription);

        break;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error(
      {
        error,
      },
      `[Stripe] Webhook handling failed`,
    );

    return throwInternalServerErrorException();
  }
};

/**
 * @description When the checkout is completed, we store the order. The
 * subscription is only activated if the order was paid successfully.
 * Otherwise, we have to wait for a further webhook
 */
const onCheckoutCompleted = async (client: SupabaseClient, session: Stripe.Checkout.Session, subscription: Stripe.Subscription) => {
  const organizationUid = getOrganizationUidFromClientReference(session);
  const customerId = session.customer as string;

  // build organization subscription and set on the organization document
  // we add just enough data in the DB, so we do not query
  // Stripe for every bit of data
  // if you need your DB record to contain further data
  // add it to {@link buildOrganizationSubscription}
  const { error, data } = await addSubscription(client, subscription);

  if (error) {
    return Promise.reject(
      `Failed to add subscription to the database: ${error}`,
    );
  }

  return setOrganizationSubscriptionData(client, {
    organizationUid,
    customerId,
    subscriptionId: data.id,
  });
};

/**
 * @name getOrganizationUidFromClientReference
 * @description Get the organization UUID from the client reference ID
 * @param session
 */
const getOrganizationUidFromClientReference = (session: Stripe.Checkout.Session) => session.client_reference_id!;
