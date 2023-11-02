import { redirect } from "next/navigation";
import { Alert, AlertTitle, Button } from "@inteligir/ui";
import Link from "next/link";
import { ResendLinkForm } from "../../components/resend-link-form";

type Params = {
  searchParams: {
    error: string;
  };
};

const AuthCallbackErrorPage = ({ searchParams }: Params) => {
  const { error } = searchParams;

  // if there is no error, redirect the user to the sign-in page
  if (!error) {
    redirect("/auth/sign-in");
  }

  return (
    <div className="flex flex-col space-y-4 py-4">
      <div>
        <Alert variant="destructive">
          <AlertTitle>Authentication Error</AlertTitle>
          Unfortunately, there was an error authenticating your account. Please
          try again.
        </Alert>
      </div>
      <ResendLinkForm />
      <div className="flex flex-col space-y-2">
        <Button asChild>
          <Link href="/auth/sign-in">Sign In</Link>
        </Button>
      </div>
    </div>
  );
};

export default AuthCallbackErrorPage;
