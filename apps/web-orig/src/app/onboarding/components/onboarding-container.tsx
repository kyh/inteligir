"use client";

import { useCallback, useState } from "react";
import CsrfTokenContext from "@/lib/csrf/csrf-provider";
import type { OrganizationInfoStepData } from "./organization-info-step";
import OrganizationInfoStep from "./organization-info-step";
import CompleteOnboardingStep from "./complete-onboarding-step";
import If from "ui/components/if";

type Data = {
  organization: string;
};

const OnboardingContainer = (
  props: React.PropsWithChildren<{
    csrfToken: string | null;
  }>,
) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<Data>();

  const onFirstStepSubmitted = useCallback(
    (organizationInfo: OrganizationInfoStepData) => {
      setFormData({
        organization: organizationInfo.organization,
      });

      setCurrentStep(1);
    },
    [],
  );

  return (
    <CsrfTokenContext.Provider value={props.csrfToken}>
      <div className="w-9/12">
        <If condition={currentStep === 0}>
          <OrganizationInfoStep onSubmit={onFirstStepSubmitted} />
        </If>

        <If condition={currentStep === 1 && formData}>
          {(formData) => <CompleteOnboardingStep data={formData} />}
        </If>
      </div>
    </CsrfTokenContext.Provider>
  );
};

export default OnboardingContainer;
