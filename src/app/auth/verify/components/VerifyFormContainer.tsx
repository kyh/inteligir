"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import configuration from "~/configuration";
import MultiFactorChallengeContainer from "~/app/auth/components/MultiFactorChallengeContainer";

function VerifyFormContainer() {
  const router = useRouter();

  const onSuccess = useCallback(() => {
    router.push("/dashboard");
  }, [router]);

  return <MultiFactorChallengeContainer onSuccess={onSuccess} />;
}

export default VerifyFormContainer;
