import React from 'react'
import ListItem from '@material-ui/core/ListItem'
import ListItemSecondaryAction from '@material-ui/core/ListItemSecondaryAction'
import ListItemText from '@material-ui/core/ListItemText'

function IntListItem({
  primaryText = '',
  secondaryText = '',
  secondaryAction = '',
  ...rest
}) {
  return (
    <ListItem {...rest}>
      <ListItemText primary={primaryText} secondary={secondaryText || null} />
      {!!secondaryAction && (
        <ListItemSecondaryAction>{secondaryAction}</ListItemSecondaryAction>
      )}
    </ListItem>
  )
}

export default IntListItem
