import React from 'react';
import renderer from 'react-test-renderer';
import { BlockLink } from '@client/components';

describe('BlockLink', () => {
  test('renders', () => {
    const json = renderer.create(<BlockLink>raw text</BlockLink>).toJSON();
    expect(json).toMatchSnapshot();
  });
});
