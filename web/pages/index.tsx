import Head from "next/head";
import { Center, Container, Heading, Text } from "@chakra-ui/react";

export const HomePage = () => {
  return (
    <>
      <Head>
        <title>Inteligir</title>
      </Head>
      <Center h="100vh">
        <Container textAlign="center">
          <Heading mb="2">Coming Soon</Heading>
          <Text>Your bite-sized micro lesson portal</Text>
        </Container>
      </Center>
    </>
  );
};

export default HomePage;
