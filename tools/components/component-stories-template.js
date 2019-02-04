function storyTemplate(componentName) {
  return `
  .add('${componentName}', () => (
    <Box padding={40}>
      {(() => {
        document.body.style.margin = '0';
        document.body.style.height = '100vh';
      })()}
      <${componentName}>${componentName}</${componentName}>
    </Box>
  ))`;
}

module.exports = ({ packageName, componentNames = [] }) => {
  return `
import { storiesOf } from '@storybook/react';
import React from 'react';
import styled from 'styled-components';
import { ${componentNames.join(', ')}, Box } from '../../${packageName}';

storiesOf('${packageName}', module)${componentNames
    .map((componentName) => storyTemplate(componentName))
    .join('')}
`.trim();
};
