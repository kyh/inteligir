import { createFileRoute } from "@tanstack/react-router";

import { OnboardingPage } from "@renderer/onboarding/onboarding-page";

export const Route = createFileRoute("/onboarding")({ component: OnboardingPage });
