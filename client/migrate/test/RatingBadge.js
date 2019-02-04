import React from 'react';
import renderer from 'react-test-renderer';
import { RatingBadge } from '../index';

describe('RatingBadge', () => {
  test('renders', () => {
    const json = renderer.create(<RatingBadge />).toJSON();
    expect(json).toMatchSnapshot();
  });
});
