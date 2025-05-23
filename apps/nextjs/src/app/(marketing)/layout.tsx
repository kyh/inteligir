import { Footer } from "./_components/footer";
import { Header } from "./_components/header";

type LayoutProps = {
  children: React.ReactNode;
};

const Layout = (props: LayoutProps) => {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl text-center">{props.children}</main>
      <Footer />
    </>
  );
};

export default Layout;
