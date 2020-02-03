import React from 'react'
import Typography from '@material-ui/core/Typography'

function Text({ children, ...props }) {
  return (
    <Typography component="p" variant="body1" {...props}>
      {children}
    </Typography>
  )
}

export default Text
