import React from 'react';
import renderer from 'react-test-renderer';
import { RatingBadge } from '@client/components';

describe('RatingBadge', () => {
  test('renders', () => {
    const json = renderer.create(<RatingBadge />).toJSON();
    expect(json).toMatchSnapshot();
  });
});
