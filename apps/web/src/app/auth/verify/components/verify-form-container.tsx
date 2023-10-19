"use client";

import { useCallback } from "react";
import MultiFactorChallengeContainer from "@/app/auth/components/multi-factor-challenge-container";

const VerifyFormContainer = () => {
  const onSuccess = useCallback(() => {
    window.location.assign("/dashboard");
  }, []);

  return <MultiFactorChallengeContainer onSuccess={onSuccess} />;
};

export default VerifyFormContainer;
