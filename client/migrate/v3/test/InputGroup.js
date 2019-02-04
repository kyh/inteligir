import React from 'react';
import renderer from 'react-test-renderer';
import { InputGroup } from '../index';

describe('InputGroup', () => {
  test('renders', () => {
    const json = renderer.create(<InputGroup />).toJSON();
    expect(json).toMatchSnapshot();
  });
});
