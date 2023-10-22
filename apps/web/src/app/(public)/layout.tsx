import loadUserData from "@/features/global/load-user-data";
import { Footer } from "./components/footer";
import { Header } from "./components/header";

export default async ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const data = await loadUserData();

  return (
    <>
      <Header session={session.data.session} />
      {children}
      <Footer />
    </>
  );
};
