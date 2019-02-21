import React from 'react';
import { storiesOf } from '@storybook/react';
import { withInfo } from '@storybook/addon-info';
import { Image, Box, Text, Flex } from '@client/components';

const image =
  'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?ixlib=rb-0.3.5&q=80&fm=jpg&crop=entropy&cs=tinysrgb&w=1080&fit=max&s=aee8a50c86478d935556d865624506e4';
const description = 'A low-level layout component that renders an image';

storiesOf('Image', module)
  .add(
    'Image component',
    withInfo({ text: description })(() => (
      <Image src="https://cdn.dribbble.com/users/29678/screenshots/5968805/036_lemon.png" />
    )),
  )

  .add('Responsive width, with Box', () => (
    <Box width={1 / 2}>
      <Image src="https://cdn.dribbble.com/users/29678/screenshots/5956711/flowerpot.png" />
    </Box>
  ))
  .add('Background image', () => (
    <Box>
      <Image.Background src={image} width="320px">
        <Box p={4}>
          <Text fontSize={6} bold textAlign="center" color="white">
            Hello
          </Text>
        </Box>
      </Image.Background>
    </Box>
  ))
  .add('Background image with fixed height', () => (
    <Box>
      <Image.Background height="320px" src={image} width="360px">
        <Box p={4}>
          <Text fontSize={6} bold textAlign="center" color="white">
            Hello
          </Text>
        </Box>
      </Image.Background>
    </Box>
  ))
  .add('Responsive background image', () => (
    <Flex>
      <Image.Background
        width={['100px', '216px', '260px']}
        height="320px"
        src={image}
      >
        <Box p={4}>
          <Text fontSize={6} bold textAlign="center" color="white">
            Hello
          </Text>
        </Box>
      </Image.Background>
    </Flex>
  ));
