import React from 'react';
import { Grid, Cell } from 'styled-css-grid';
import {
  Container,
  ListCard,
  List,
  Card,
  PromotedCard,
  Flex,
} from '@client/components';

const Discover = () => (
  <Container p={20}>
    <img
      src="/static/assets/discover.jpg"
      alt=""
      style={{
        width: '1440px',
        position: 'absolute',
        pointerEvents: 'none',
        opacity: '0.1',
        top: 0,
        left: 0,
      }}
    />
    <Grid
      columns="250px 1fr"
      gap="24px"
      areas={['menu search', 'menu content', 'ad content']}
    >
      <Cell area="menu">
        <ListCard title="Browse Categories">
          <List.Item>Top Sellers</List.Item>
          <List.Item>Recently Updated</List.Item>
          <List.Item>New Releases</List.Item>
          <List.Item>Upcoming</List.Item>
          <List.Item>Specials</List.Item>
          <List.Item>Virtual Reality</List.Item>
          <List.Item>Steam Controller Friendly</List.Item>
        </ListCard>
      </Cell>
      <Cell area="search">
        <Card py={3}>
          <Flex>Search</Flex>
        </Card>
      </Cell>
      <Cell area="ad">
        <Card py={3}>
          <Flex>Ad</Flex>
        </Card>
      </Cell>
      <Cell area="content">
        <PromotedCard />
      </Cell>
    </Grid>
  </Container>
);

export default Discover;
