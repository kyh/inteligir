"use client";

import { useState } from "react";
import classNames from "clsx";
import { CheckCircleIcon, SparklesIcon } from "@heroicons/react/24/outline";
import Heading from "@/lib/ui/Heading";
import Button from "@/lib/ui/Button";
import If from "@/lib/ui/If";
import Trans from "@/lib/ui/Trans";
import configuration from "~/configuration";

type CheckoutButtonProps = {
  readonly stripePriceId?: string;
  readonly recommended?: boolean;
};

type PricingItemProps = {
  selectable: boolean;
  product: {
    name: string;
    features: string[];
    description: string;
    recommended?: boolean;
    badge?: string;
  };
  plan: {
    name: string;
    stripePriceId?: string;
    price: string;
    label?: string;
    href?: string;
  };
};

const STRIPE_PRODUCTS = configuration.stripe.products;

const STRIPE_PLANS = STRIPE_PRODUCTS.reduce<string[]>((acc, product) => {
  product.plans.forEach((plan) => {
    if (plan.name && !acc.includes(plan.name)) {
      acc.push(plan.name);
    }
  });

  return acc;
}, []);

const PricingTable = (
  props: React.PropsWithChildren<{
    CheckoutButton?: React.ComponentType<CheckoutButtonProps>;
  }>,
) => {
  const [planVariant, setPlanVariant] = useState<string>(STRIPE_PLANS[0]);

  return (
    <div className="flex flex-col space-y-12">
      <div className="flex justify-center">
        <PlansSwitcher
          plan={planVariant}
          plans={STRIPE_PLANS}
          setPlan={setPlanVariant}
        />
      </div>

      <div
        className={
          "flex flex-col items-start space-y-6 lg:space-y-0" +
          " justify-center lg:flex-row lg:space-x-4"
        }
      >
        {STRIPE_PRODUCTS.map((product) => {
          const plan =
            product.plans.find((item) => item.name === planVariant) ??
            product.plans[0];

          return (
            <PricingItem
              CheckoutButton={props.CheckoutButton}
              key={plan.stripePriceId ?? plan.name}
              plan={plan}
              product={product}
              selectable
            />
          );
        })}
      </div>
    </div>
  );
};

export default PricingTable;

PricingTable.Item = PricingItem;
PricingTable.Price = Price;
PricingTable.FeaturesList = FeaturesList;

const PricingItem = (
  props: React.PropsWithChildren<
    PricingItemProps & {
      CheckoutButton?: React.ComponentType<CheckoutButtonProps>;
    }
  >,
) => {
  const recommended = props.product.recommended ?? false;

  return (
    <div
      className={classNames(
        `
         relative flex w-full flex-col justify-between space-y-6 rounded-xl
         p-6 lg:w-4/12 xl:max-w-xs xl:p-8 2xl:w-3/12
      `,
        {
          "dark:border-dark-900 border-2 border-gray-100": !recommended,
          "border-primary border-2": recommended,
        },
      )}
      data-cy="subscription-plan"
    >
      <div className="flex flex-col space-y-2.5">
        <div className="flex items-center space-x-6">
          <Heading type={3}>
            <b className="font-semibold">{props.product.name}</b>
          </Heading>

          <If condition={props.product.badge}>
            <div
              className={classNames(
                `flex space-x-1 rounded-md px-2 py-1 text-xs font-medium`,
                {
                  "text-primary-foreground bg-primary": recommended,
                  "bg-gray-50 text-gray-500 dark:text-gray-800": !recommended,
                },
              )}
            >
              <If condition={recommended}>
                <SparklesIcon className="mr-1 h-4 w-4" />
              </If>
              <span>{props.product.badge}</span>
            </div>
          </If>
        </div>

        <span className="text-sm text-gray-500 dark:text-gray-400">
          {props.product.description}
        </span>
      </div>

      <div className="flex items-end space-x-1">
        <Price>{props.plan.price}</Price>

        <If condition={props.plan.name}>
          <span
            className={classNames(
              `text-lg lowercase text-gray-500 dark:text-gray-400`,
            )}
          >
            <span>/</span>
            <span>{props.plan.name}</span>
          </span>
        </If>
      </div>

      <div className="text-current">
        <FeaturesList features={props.product.features} />
      </div>

      <If condition={props.selectable}>
        <If
          condition={props.plan.stripePriceId ? props.CheckoutButton : null}
          fallback={
            <DefaultCheckoutButton
              plan={props.plan}
              recommended={recommended}
            />
          }
        >
          {(CheckoutButton) => (
            <CheckoutButton
              recommended={recommended}
              stripePriceId={props.plan.stripePriceId}
            />
          )}
        </If>
      </If>
    </div>
  );
};

const FeaturesList = (
  props: React.PropsWithChildren<{
    features: string[];
  }>,
) => (
  <ul className="flex flex-col space-y-2">
    {props.features.map((feature) => {
      return (
        <ListItem key={feature}>
          <Trans
            defaults={feature}
            i18nKey={`common:plans.features.${feature}`}
          />
        </ListItem>
      );
    })}
  </ul>
);

const Price = ({ children }: React.PropsWithChildren) => {
  // little trick to re-animate the price when switching plans
  const key = Math.random();

  return (
    <div
      className="duration-500 animate-in fade-in slide-in-from-left-4"
      key={key}
    >
      <span className="text-2xl font-bold lg:text-3xl xl:text-4xl">
        {children}
      </span>
    </div>
  );
};

const ListItem = ({ children }: React.PropsWithChildren) => (
  <li className="flex items-center space-x-3 font-medium">
    <div>
      <CheckCircleIcon className="h-5" />
    </div>

    <span className="text-sm text-gray-600 dark:text-gray-300">{children}</span>
  </li>
);

const PlansSwitcher = (
  props: React.PropsWithChildren<{
    plans: string[];
    plan: string;
    setPlan: (plan: string) => void;
  }>,
) => (
  <div className="flex">
    {props.plans.map((plan, index) => {
      const selected = plan === props.plan;

      const className = classNames("focus:!ring-0 !outline-none", {
        "rounded-r-none": index === 0,
        "rounded-l-none": index === props.plans.length - 1,
        ["border-gray-100 dark:border-dark-800 hover:bg-gray-50" +
        " dark:hover:bg-background/80"]: !selected,
      });

      return (
        <Button
          className={className}
          key={plan}
          onClick={() => {
            props.setPlan(plan);
          }}
          variant={selected ? "outlinePrimary" : "outline"}
        >
          <span className="flex items-center space-x-2">
            <If condition={selected}>
              <CheckCircleIcon className="h-4" />
            </If>

            <span>
              <Trans defaults={plan} i18nKey={`common:plans.${plan}`} />
            </span>
          </span>
        </Button>
      );
    })}
  </div>
);

const DefaultCheckoutButton = (
  props: React.PropsWithChildren<{
    plan: PricingItemProps["plan"];
    recommended?: boolean;
  }>,
) => {
  const linkHref =
    props.plan.href ??
    `${configuration.paths.signUp}?utm_source=${props.plan.stripePriceId}`;

  const label = props.plan.label ?? "common:getStarted";

  return (
    <div className="bottom-0 left-0 w-full p-0">
      <Button
        block
        href={linkHref}
        variant={props.recommended ? "default" : "outline"}
      >
        <Trans defaults={label} i18nKey={label} />
      </Button>
    </div>
  );
};
