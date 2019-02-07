import { storiesOf } from '@storybook/react';
import React from 'react';
import styled from 'styled-components';
import { List, Box } from '@client/components';

storiesOf('List', module)
  .add('List component', () => (
    <Box padding={40}>
      {(() => {
        document.body.style.margin = '0';
        document.body.style.height = '100vh';
      })()}
      <List>List</List>
    </Box>
  ))