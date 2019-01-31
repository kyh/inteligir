import React from 'react';
import { Grid, Cell } from 'styled-css-grid';

import theme from '@client/utils/theme';
import Container from '@client/components/styles/Container';
import { Card, CardHeader } from '@client/components/styles/Card';

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
    <Grid columns={10} gap={theme.baseSpacing2}>
      <Cell width={2}>
        <Card>
          <CardHeader>Browse Categories</CardHeader>
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
