import { MainScreen } from '@/components/screens/main-screen';

export default function Layout(props: LayoutProps<'/'>) {
  const { children } = props;
  return (
    <MainScreen className="flex justify-center" size="full">
      {children}
    </MainScreen>
  );
}
