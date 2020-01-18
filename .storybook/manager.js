import { addons } from '@storybook/addons'
import { create } from '@storybook/theming'
import { theme } from '@utils/theme'

export const storyTheme = create({
  base: 'light',
  brandTitle: 'Inteligir Design System',
  brandUrl: 'https://github.com/its-bananas/inteligir',
  colorPrimary: theme.brand.primary,
  colorSecondary: theme.brand.secondary,
})

addons.setConfig({
  theme: storyTheme,
  isFullscreen: false,
  panelPosition: 'bottom',
  isToolshown: true,
})
