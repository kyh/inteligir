import type { Provider } from "@supabase/gotrue-js/src/lib/types";

const production = process.env.NODE_ENV === "production";

const configuration = {
  site: {
    name: "Inteligir - Your SaaS Title",
    description: "Your SaaS Description",
    themeColor: "#ffffff",
    themeColorDark: "#0a0a0a",
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    siteName: "Inteligir",
    twitterHandle: "",
    githubHandle: "",
    language: "en",
    convertKitFormId: "",
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
  enableThemeSwitcher: true,
  paths: {
    signIn: "/auth/sign-in",
    signUp: "/auth/sign-up",
    signInFromLink: "/auth/link",
    signInMfa: "/auth/verify",
    onboarding: `/onboarding`,
    appHome: "/dashboard",
    settings: {
      profile: "/settings/profile",
      authentication: "/settings/profile/authentication",
      email: "/settings/profile/email",
      password: "/settings/profile/password",
    },
    api: {
      checkout: `/api/stripe/checkout`,
      billingPortal: `/api/stripe/portal`,
      organizations: {
        create: `/api/organizations`,
        current: `/api/organizations/[organization]/current`,
        transferOwnership: `/api/organizations/owner`,
        members: `/api/organizations/members`,
        member: `/api/organizations/members/[member]`,
      },
    },
  },
  email: {
    host: "",
    port: 587,
    user: "",
    password: "",
    senderAddress: "Inteligir Team <info@inteligir.dev>",
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

export default configuration;
