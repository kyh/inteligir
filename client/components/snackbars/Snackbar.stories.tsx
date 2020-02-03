import React from 'react'
import { Snackbar } from '@components'

export default {
  title: 'Components|Feedback|Snackbar',
}

export const SnackbarComponent = () => (
  <div>
    <Snackbar open />
  </div>
)

SnackbarComponent.story = {
  name: 'Snackbar component',
}
