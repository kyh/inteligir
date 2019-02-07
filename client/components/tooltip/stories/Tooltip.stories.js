import React from 'react';
import { storiesOf } from '@storybook/react';
import styled from 'styled-components';
import { Tooltip, Box, Flex } from '@client/components';

const FlexColumn = styled(Flex)`
  flex-direction: column;
`;

storiesOf('Tooltip', module)
  .add('Without Anchors', () => (
    <Box mt={5} width={500}>
      <Tooltip bg="blue" color="white" top left>
        left tooltip
      </Tooltip>
      <Tooltip bg="black" color="white" top center>
        centered tooltip
      </Tooltip>
      <Tooltip bg="red" color="white" top right>
        right tooltip
      </Tooltip>
      <br />
      <Tooltip bottom left>
        left tooltip
      </Tooltip>
      <Tooltip bottom center>
        centered tooltip
      </Tooltip>
      <Tooltip bottom right>
        right tooltip
      </Tooltip>
    </Box>
  ))
  .add('With Anchors', () => (
    <FlexColumn justifyContent="space-between" wrap="wrap">
      <Box width={300} p={2} my={2}>
        <Tooltip top left bg="blue" color="white">
          top left tooltip
        </Tooltip>
        <div>some text</div>
      </Box>
      <Box width="300px" p={2} mb={5}>
        <div>some text</div>
        <Tooltip bottom left bg="red" color="white">
          bottom left tooltip
        </Tooltip>
      </Box>
    </FlexColumn>
  ));
