import { redirect } from "next/navigation";
import { Alert, AlertTitle, Button } from "@inteligir/ui";

type Params = {
  searchParams: StringObject;
};

const AuthCallbackErrorPage = ({ searchParams }: Params) => {
  const error = searchParams.error;

  // if there is no error, redirect the user to the sign-in page
  if (!error) {
    redirect("/auth/sign-in");
  }

  return (
    <div className="flex flex-col space-y-6 py-4">
      <Alert variant="destructive">
        <AlertTitle>Authentication Error</AlertTitle>
        Unfortunately, there was an error authenticating your account. Please
        try again.
      </Alert>
      <Button>
        <a href="/auth/sign-in">Sign In</a>
      </Button>
    </div>
  );
};

export default AuthCallbackErrorPage;
