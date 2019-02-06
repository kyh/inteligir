import React from 'react';
import { Grid, Cell } from 'styled-css-grid';

import theme from '@client/utils/theme';
import { Container, Card } from '@client/components';

const Discover = () => (
  <Container>
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
    <Grid columns={10} gap={`${theme.space[4]}px`}>
      <Cell width={2}>
        <Card>
          <Card.Header>Browse Categories</Card.Header>
          <ul>
            <li>Top Sellers</li>
            <li>Recently Updated</li>
            <li>New Releases</li>
            <li>Upcoming</li>
            <li>Specials</li>
            <li>Virtual Reality</li>
            <li>Steam Controller Friendly</li>
          </ul>
        </Card>
      </Cell>
      <Cell width={8}>Rest of the content</Cell>
    </Grid>
  </Container>
);

export default Discover;
