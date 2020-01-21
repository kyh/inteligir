import React from 'react'
import Typography from '@material-ui/core/Typography'

const Header: React.FC = ({ children, ...props }) => {
  return (
    <Typography gutterBottom component="h1" variant="h4" {...props}>
      {children}
    </Typography>
  )
}

export default Header
