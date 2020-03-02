import React from 'react'
import Tabs from '@material-ui/core/Tabs'
import { makeStyles } from '@material-ui/styles'

const useTabsStyles = makeStyles((theme) => ({
  root: {
    borderBottom: `1px solid ${theme.brand.borderColor}`,
    overflow: 'visible',
  },
  fixed: {
    overflowX: 'visible',
  },
  indicator: {
    height: 1,
    backgroundColor: theme.brand.black,
  },
}))

const IntTabs = ({ children = '', ...props }) => {
  const classes = useTabsStyles()
  return (
    <Tabs classes={classes} {...props}>
      {children}
    </Tabs>
  )
}

export default IntTabs
