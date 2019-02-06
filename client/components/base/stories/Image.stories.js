import React from 'react';
import { storiesOf } from '@storybook/react';
import { withInfo } from '@storybook/addon-info';
import { Image, Box } from '@client/components';

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
  ));
