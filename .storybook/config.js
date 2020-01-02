import { configure, addDecorator, addParameters } from '@storybook/react';
import { withKnobs } from '@storybook/addon-knobs';
import { withA11y } from '@storybook/addon-a11y';
import { storyTheme, withTheme } from './utils';

addParameters({
  options: {
    theme: storyTheme,
    isFullscreen: false,
    panelPosition: 'bottom',
    isToolshown: true,
  },
  docs: {
    // Styles for MDX
  },
});

addDecorator(withTheme);
addDecorator(withA11y);
addDecorator(withKnobs);

configure(
  require.context('../client/components', true, /\.stories\.(js|mdx)$/),
  module,
);
