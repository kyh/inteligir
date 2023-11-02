"use client";

import type { Stripe } from "stripe";
import { CheckIcon, ChevronRightIcon } from "@heroicons/react/24/outline";
import Heading from "@inteligir/ui/heading";
import Button from "@inteligir/ui/button";
import Trans from "@inteligir/ui/trans";
import { configuration } from "@/lib/configuration";

/**
 * Retrieves the session status for a Stripe checkout session.
 * Since we should only arrive here for a successful checkout, we only check
 * for the `paid` status.
 *
 * @param {Stripe.Checkout.Session['status']} status - The status of the Stripe checkout session.
 * @param {string} customerEmail - The email address of the customer associated with the session.
 *
 * @returns {ReactElement} - The component to render based on the session status.
 */
export const StripeSessionStatus = ({
  customerEmail,
}: React.PropsWithChildren<{
  status: Stripe.Checkout.Session["status"];
  customerEmail: string;
}>) => <SuccessSessionStatus customerEmail={customerEmail} />;

const SuccessSessionStatus = ({
  customerEmail,
}: React.PropsWithChildren<{
  customerEmail: string;
}>) => (
  <section
    className={
      "mx-auto max-w-xl rounded-xl border p-16 fade-in xl:drop-shadow-sm" +
      " dark:border-dark-800 border-gray-100" +
      " bg-background ease-out animate-in slide-in-from-bottom-8" +
      " dark:shadow-primary/40 duration-1000 zoom-in-50 dark:shadow-2xl"
    }
    data-cy="payment-return-success"
  >
    <div className="flex flex-col items-center justify-center space-y-4 text-center">
      <CheckIcon
        className={
          "w-16 rounded-full bg-green-500 p-1 text-white ring-8" +
          " ring-green-500/30 dark:ring-green-500/50"
        }
      />

      <Heading type={3}>
        <span className="mr-4 font-semibold">Done! You're all set.</span>
        🎉
      </Heading>

      <div className="flex flex-col space-y-4 text-gray-500 dark:text-gray-400">
        <p>
          Thank you for subscribing, we have successfully processed your
          subscription! A confirmation email will be sent to {{ customerEmail }}
          .
        </p>
      </div>

      <Button
        data-cy="checkout-success-back-button"
        href={configuration.paths.appHome}
        variant="outline"
      >
        <span className="flex items-center space-x-2.5">
          <span>Proceed to App</span>

          <ChevronRightIcon className="h-4" />
        </span>
      </Button>
    </div>
  </section>
);
