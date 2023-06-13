"use client";

import PhoneNumberCredentialForm from "~/app/auth/components/PhoneNumberCredentialForm";

const PhoneNumberSignInContainer: React.FC<{
  onSignIn: () => unknown;
}> = ({ onSignIn }) => {
  return <PhoneNumberCredentialForm action="signIn" onSuccess={onSignIn} />;
};

export default PhoneNumberSignInContainer;
