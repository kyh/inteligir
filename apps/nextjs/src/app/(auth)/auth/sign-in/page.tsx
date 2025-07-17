import { AuthForm } from "@/app/(auth)/_components/auth-form";

export const generateMetadata = () => {
  return {
    title: "Sign In",
  };
};

const Page = () => {
  return (
    <div className="mx-auto flex w-[300px] flex-col justify-center space-y-6">
      <div className="flex flex-col text-center">
        <h1 className="text-lg font-light">Welcome back</h1>
      </div>
      <AuthForm type="signin" />
    </div>
  );
};

export default Page;
