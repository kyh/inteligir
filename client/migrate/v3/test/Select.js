import React from 'react';
import renderer from 'react-test-renderer';
import { Select } from '../index';

describe('Select', () => {
  test('renders', () => {
    const json = renderer.create(<Select />).toJSON();
    expect(json).toMatchSnapshot();
  });
});
