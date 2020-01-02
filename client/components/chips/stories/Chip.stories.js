import React from 'react';
import { Chip } from '@components';

export default {
  title: 'Components|Data Display|Chip',
};

export const ChipComponent = () => (
  <div>
    <Chip label="Basic Chip" />
  </div>
);

ChipComponent.story = {
  name: 'Chip component',
};
