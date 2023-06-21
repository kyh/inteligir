"use client";

import { useCallback, useState } from "react";
import CsrfTokenContext from "~/lib/contexts/csrf";
import If from "~/components/If";
import CompleteOnboardingStep from "./CompleteOnboardingStep";
import OrganizationInfoStep, {
  OrganizationInfoStepData,
} from "./OrganizationInfoStep";

type FormData = {
  organization: string;
};

type OnboardingContainerProps = {
  csrfToken: string | null;
};

function OnboardingContainer({ csrfToken }: OnboardingContainerProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<FormData>();

  const onFirstStepSubmitted = useCallback(
    (organizationInfo: OrganizationInfoStepData) => {
      setFormData({
        organization: organizationInfo.organization,
      });

      setCurrentStep(1);
    },
    []
  );

  return (
    <CsrfTokenContext.Provider value={csrfToken}>
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
}

export default OnboardingContainer;
