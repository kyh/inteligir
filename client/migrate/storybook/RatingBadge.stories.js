import React from 'react';
import { storiesOf } from '@storybook/react';
import { RatingBadge } from '@client/components';

storiesOf('RatingBadge', module).add('default', () => (
  <RatingBadge>9.0</RatingBadge>
));
