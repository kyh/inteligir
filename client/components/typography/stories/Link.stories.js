import React from 'react';
import { storiesOf } from '@storybook/react';
import { Image, Link, Box, Flex, Text } from '@client/components';

const image =
  'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?ixlib=rb-0.3.5&q=80&fm=jpg&crop=entropy&cs=tinysrgb&w=1080&fit=max&s=aee8a50c86478d935556d865624506e4';

storiesOf('Link', module)
  .add('Link component', () => (
    <Link href="https://www.inteligir.com/" target="_blank">
      Home
    </Link>
  ))
  .add('Link open self', () => (
    <Link href="https://www.inteligir.com/" target="_self">
      Open the Home in the same window
    </Link>
  ))
  .add('Color', () => (
    <Link href="https://www.inteligir.com/" color="white">
      I'm a different color!
    </Link>
  ))
  .add('Link.Block containing background image', () => (
    <Flex justifyContent="center" alignItems="center" color="white">
      <Link.Block href="https://www.google.com" target="_blank">
        <Image.Background image={image} width="640px">
          <Box p={4}>
            <Text textAlign="center">Click to open google.com in new tab!</Text>
          </Box>
        </Image.Background>
      </Link.Block>
    </Flex>
  ))
  .add('Link.Block composition without container', () => (
    <Link.Block href="https://www.google.com" p={3}>
      <Text fontSize={2} bold textAlign="center">
        Click to go to google.com!
      </Text>
    </Link.Block>
  ));
