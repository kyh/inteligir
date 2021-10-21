import tw from "tailwind-styled-components";
import { SEO, Heading, Text } from "@components";
import { useCurrentUser } from "@libs/auth/data/authHooks";

const Page = tw.main`flex h-screen`;
const Container = tw.section`m-auto text-center`;

export const HomePage = () => {
  const { isLoggedIn, user } = useCurrentUser();
  console.log(isLoggedIn, user);
  return (
    <>
      <SEO />
      <Page>
        <Container>
          <Heading className="mb-2">Coming Soon</Heading>
          <Text>Bite-sized learning</Text>
        </Container>
      </Page>
    </>
  );
};

export default HomePage;
