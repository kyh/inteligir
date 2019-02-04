import React from 'react';
import { storiesOf } from '@storybook/react';
import { RatingBadge } from '../index';

storiesOf('RatingBadge', module).add('default', () => (
  <RatingBadge>9.0</RatingBadge>
));
