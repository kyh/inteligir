import { redirect } from "next/navigation";
import { Alert } from "~/components/Alert";
import { Button } from "~/components/Button";

interface Params {
  searchParams: StringObject;
}

function AuthCallbackErrorPage({ searchParams }: Params) {
  const error = searchParams.error;
  console.error(error);

  // if there is no error, redirect the user to the sign-in page
  if (!error) {
    redirect("/auth/sign-in");
  }

  return (
    <div className="flex flex-col space-y-6 py-4">
      <Alert type="error" heading="Authentication Error">
        Unfortunately, there was an error authenticating your account. Please
        try again.
      </Alert>
      <Button as="a" href="/auth/sign-in">
        Sign In
      </Button>
    </div>
  );
}

export default AuthCallbackErrorPage;
