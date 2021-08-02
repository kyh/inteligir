import { SEO } from "components/SEO";
import { Center, Container, Heading, Text } from "@chakra-ui/react";

export const HomePage = () => {
  return (
    <>
      <SEO />
      <Center h="100vh">
        <Container textAlign="center">
          <Heading mb="2">Coming Soon</Heading>
          <Text>Bite-sized learning</Text>
        </Container>
      </Center>
    </>
  );
};

export default HomePage;
