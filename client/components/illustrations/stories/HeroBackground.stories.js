import { storiesOf } from '@storybook/react';
import React from 'react';
import { HeroBackground, FooterBackground, Box } from '@client/components';

storiesOf('Illustrations', module)
  .add('HeroBackground component', () => (
    <Box padding={40}>
      {(() => {
        document.body.style.margin = '0';
        document.body.style.height = '100vh';
      })()}
      <HeroBackground />
    </Box>
  ))
  .add('FooterBackground component', () => (
    <Box padding={40}>
      {(() => {
        document.body.style.margin = '0';
        document.body.style.height = '100vh';
      })()}
      <FooterBackground />
    </Box>
  ));
