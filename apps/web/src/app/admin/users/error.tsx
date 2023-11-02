"use client";

import { Alert, AlertDescription, AlertTitle } from "@inteligir/ui";
import AppContainer from "@/app/dashboard/components/app-container";

const UsersAdminPageError = () => {
  return (
    <AppContainer>
      <Alert>
        <AlertTitle>Could not load users</AlertTitle>
        <AlertDescription>
          There was an error loading the users. Please check your console
          errors.
        </AlertDescription>
      </Alert>
    </AppContainer>
  );
};

export default UsersAdminPageError;
