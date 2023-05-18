"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import useSWRMutation from "swr/mutation";
import configuration from "~/configuration";
import useApiRequest from "~/core/hooks/use-api";
import useCsrfTokenHeader from "~/core/hooks/use-csrf-token-header";
import Spinner from "~/components/Spinner";

interface CompleteOnboardingStepData {
  organization: string;
}

const CompleteOnboardingStep: React.FC<{
  data: CompleteOnboardingStepData;
}> = ({ data }) => {
  const router = useRouter();
  const { trigger } = useCompleteOnboardingRequest();
  const submitted = useRef(false);

  const callRequestCallback = useCallback(async () => {
    if (submitted.current) {
      return;
    }

    submitted.current = true;

    try {
      await trigger(data);
      router.push(configuration.paths.appHome);
    } catch (e) {
      submitted.current = false;
    }
  }, [data, trigger, router]);

  useEffect(() => {
    void callRequestCallback();
  }, [callRequestCallback]);

  return (
    <div className="flex flex-1 flex-col items-center space-y-8">
      <span>
        <Spinner className="h-12 w-12" />
      </span>

      <span>Getting Started. Please wait...</span>
    </div>
  );
};

function useCompleteOnboardingRequest() {
  const fetcher = useApiRequest<
    unknown,
    {
      organization: string;
    }
  >();
  const csrfTokenHeader = useCsrfTokenHeader();
  const endpoint = `/onboarding/complete`;

  return useSWRMutation(
    endpoint,
    (
      path,
      {
        arg: body,
      }: {
        arg: {
          organization: string;
        };
      }
    ) => {
      return fetcher({
        path,
        method: "POST",
        body,
        headers: csrfTokenHeader,
      });
    }
  );
}

export default CompleteOnboardingStep;
