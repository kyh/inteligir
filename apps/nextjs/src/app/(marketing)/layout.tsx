type LayoutProps = {
  children: React.ReactNode;
};

const Layout = (props: LayoutProps) => {
  return <main className="contained-page">{props.children}</main>;
};

export default Layout;
