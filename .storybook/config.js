import React from 'react'
import { StylesProvider } from '@material-ui/styles'
import { addDecorator } from '@storybook/react'

const StylesDecorator = (storyFn) => <StylesProvider injectFirst>{storyFn()}</StylesProvider>

addDecorator(StylesDecorator)
