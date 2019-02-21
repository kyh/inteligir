import React from 'react';
import Head from 'next/head';
import styled from 'styled-components';

import {
  Text,
  Container,
  Heading,
  HeroBackground,
  ConnectIcon,
  EarnIcon,
  SquaresIcon,
  Flex,
  Footer,
} from '@client/components';

const HeroContainer = styled.div`
  display: flex;
  max-width: 1128px;
  padding-left: 24px;
  padding-right: 24px;
  margin: 0 auto;

  h1,
  h2,
  h3,
  h4,
  h5 {
    color: #fff;
  }
`;

const HeroCopy = styled.div`
  @media (min-width: 641px) {
    padding-top: 80px;
    padding-right: 48px;
    min-width: 512px;
    width: 512px;
  }
`;

const FeatureContainer = styled.div`
  max-width: 400px;
  @media (min-width: 641px) {
    padding-top: 88px;
    padding-bottom: 88px;
  }
`;

const Feature = styled.div`
  padding-top: 16px;
  padding-bottom: 16px;
  @media (min-width: 641px) {
    padding-top: 24px;
    padding-bottom: 24px;
  }
`;

const Home = () => (
  <Container>
    <Head>
      <title>Inteligir | Making open source accessible for everyone</title>
      <script src="https://unpkg.com/scrollreveal@4.0.0/dist/scrollreveal.min.js" />
      <script src="/static/landing-page/main.min.js" />
    </Head>
    <HeroContainer>
      <HeroCopy>
        <Heading.h1 mb={16}>Open source, epically.</Heading.h1>
        <Text.p>
          Contributing to open source shouldn’t be scary. Inteligir makes it
          easy for anyone to participate.
        </Text.p>
      </HeroCopy>
      <HeroBackground />
    </HeroContainer>
    <HeroContainer>
      <FeatureContainer>
        <Feature>
          <Flex mb={16}>
            <SquaresIcon />
            <Heading.h4 ml={16}>Discover</Heading.h4>
          </Flex>
          <Text.p>
            Find a perfect Quest whether you’re a coder, designer, organizer,
            writer, or just want to help!
          </Text.p>
        </Feature>
        <Feature>
          <Flex mb={16}>
            <EarnIcon />
            <Heading.h4 ml={16}>Earn Rewards</Heading.h4>
          </Flex>
          <Text.p>
            Complete Quests to gain experience, collect loot, and enhance your
            skills as an open source contributor.
          </Text.p>
        </Feature>
        <Feature>
          <Flex mb={16}>
            <ConnectIcon />
            <Heading.h4 ml={16}>Build the community</Heading.h4>
          </Flex>
          <Text.p>
            Learn, teach, and build everlasting friendships with fellow
            contributors.
          </Text.p>
        </Feature>
      </FeatureContainer>
    </HeroContainer>
    <Footer />
  </Container>
);

export default Home;
