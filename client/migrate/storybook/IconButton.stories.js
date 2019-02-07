import React from 'react';
import { storiesOf } from '@storybook/react';
import { calendar } from 'react-icons-kit/feather/calendar';
import { IconButton } from '@client/components';

storiesOf('IconButton', module)
  .add('default', () => <IconButton icon={calendar} title="Choose date" />)
  .add('with color', () => (
    <IconButton icon={calendar} color="blue" title="Choose date" />
  ))
  .add('with size', () => (
    <IconButton icon={calendar} size={64} title="Choose date" />
  ))
  .add('with other elements', () => (
    <IconButton icon={calendar} size={64} title="Choose date" />
  ));
