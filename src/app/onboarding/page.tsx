import { headers } from "next/headers";
import { use } from "react";
import OnboardingContainer from "./components/OnboardingContainer";

export const metadata = {
  title: "Onboarding",
};

function OnboardingPage() {
  const { csrfToken } = use(loadData());

  return <OnboardingContainer csrfToken={csrfToken} />;
}

export default OnboardingPage;

async function loadData() {
  const csrfToken = headers().get("X-CSRF-Token");

  return {
    csrfToken,
  };
}
