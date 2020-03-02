import React from 'react'
import Typography from '@material-ui/core/Typography'

function Header({ children = '', ...rest }) {
  return (
    <Typography gutterBottom component="h1" variant="h4" {...rest}>
      {children}
    </Typography>
  )
}

export default Header
