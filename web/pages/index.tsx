import { SEO, Page, Container, Heading, Text } from "components";

export const HomePage = () => {
  return (
    <>
      <SEO />
      <Page>
        <Container tw="text-center m-auto">
          <Heading>Coming Soon</Heading>
          <Text>Bite-sized learning</Text>
        </Container>
      </Page>
    </>
  );
};

export default HomePage;
