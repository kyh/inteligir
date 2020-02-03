import React from 'react'
import Typography from '@material-ui/core/Typography'

function Header({ children, ...props }) {
  return (
    <Typography gutterBottom component="h1" variant="h4" {...props}>
      {children}
    </Typography>
  )
}

export default Header
