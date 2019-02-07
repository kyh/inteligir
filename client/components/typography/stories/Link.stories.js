import React from 'react';
import { storiesOf } from '@storybook/react';
import { Link } from '@client/components';

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
  .add('Color', () => <Link color="darkGray">I'm a different color!</Link>);
