import { storiesOf } from '@storybook/react';
import React from 'react';
import {
  ConnectIcon,
  EarnIcon,
  SquaresIcon,
  Flex,
  Box,
} from '@client/components';

storiesOf('Icons', module).add('List of Icons', () => (
  <Flex padding={40}>
    {(() => {
      document.body.style.margin = '0';
      document.body.style.height = '100vh';
    })()}
    <Box mr={20}>
      <ConnectIcon />
    </Box>
    <Box mr={20}>
      <EarnIcon />
    </Box>
    <Box mr={20}>
      <SquaresIcon />
    </Box>
  </Flex>
));
