import { addons } from '@storybook/addons'
import { create } from '@storybook/theming'

export const storyTheme = create({
  base: 'light',
  brandTitle: 'Inteligir Design System',
  brandUrl: 'https://github.com/its-bananas/inteligir',
  colorPrimary: '#1865f2',
  colorSecondary: '#3B475F',
})

addons.setConfig({
  theme: storyTheme,
  isFullscreen: false,
  panelPosition: 'bottom',
  isToolshown: true,
})
