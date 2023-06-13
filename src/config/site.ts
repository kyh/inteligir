import type { Provider } from "@supabase/gotrue-js/src/lib/types";

const production = process.env.NODE_ENV === "production";

export const config = {
  site: {
    name: "Inteligir - Personalized AI assistants built for teams",
    description:
      "Create a multi-platform, privacy-first, hyper-relevant AI assistant that fits effortlessly in your organizations workflow",
    themeColor: "#ffffff",
    themeColorDark: "#0a0a0a",
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    siteName: "Inteligir",
    twitterUrl: "",
    githubUrl: "",
    discordUrl: "",
    language: "en",
    convertKitFormId: "5222442",
    locale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  },
  auth: {
    // ensure this is the same as your Supabase project
    // by default - it's true in production and false in development
    requireEmailConfirmation:
      process.env.NEXT_PUBLIC_REQUIRE_EMAIL_CONFIRMATION === "true",
    // NB: Enable the providers below in the Supabase Console
    // in your production project
    providers: {
      emailPassword: true,
      phoneNumber: false,
      emailLink: false,
      oAuth: ["google"] as Provider[],
    },
  },
  production,
  environment: process.env.NEXT_PUBLIC_ENVIRONMENT,
  email: {
    host: "",
    port: 587,
    user: "",
    password: "",
    senderAddress: "Inteligir Team <info@inteligir.com>",
  },
  sentry: {
    dsn: process.env.SENTRY_DSN,
  },
  stripe: {
    products: [
      {
        name: "Basic",
        description: "Description of your Basic plan",
        badge: `Up to 20 users`,
        features: [
          "Basic Reporting",
          "Up to 20 users",
          "1GB for each user",
          "Chat Support",
        ],
        plans: [
          {
            name: "Monthly",
            price: "$9",
            stripePriceId: "price_1LfXGaI1i3VnbZTq7l3VgZNa",
          },
          {
            name: "Yearly",
            price: "$90",
            stripePriceId: "basic-plan-yr",
          },
        ],
      },
      {
        name: "Pro",
        badge: `Most Popular`,
        recommended: true,
        description: "Description of your Pro plan",
        features: [
          "Advanced Reporting",
          "Up to 50 users",
          "5GB for each user",
          "Chat and Phone Support",
        ],
        plans: [
          {
            name: "Monthly",
            price: "$29",
            stripePriceId: "pro-plan-mth",
          },
          {
            name: "Yearly",
            price: "$200",
            stripePriceId: "pro-plan-yr",
          },
        ],
      },
      {
        name: "Premium",
        description: "Description of your Premium plan",
        badge: ``,
        features: [
          "Advanced Reporting",
          "Unlimited users",
          "50GB for each user",
          "Account Manager",
        ],
        plans: [
          {
            name: "",
            price: "Contact us",
            stripePriceId: "",
            label: `Contact us`,
            href: `/contact`,
          },
        ],
      },
    ],
  },
};
