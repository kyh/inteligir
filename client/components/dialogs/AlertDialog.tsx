import React from 'react'
import Dialog from '@material-ui/core/Dialog'
import DialogActions from '@material-ui/core/DialogActions'
import DialogContent from '@material-ui/core/DialogContent'
import DialogContentText from '@material-ui/core/DialogContentText'
import DialogTitle from '@material-ui/core/DialogTitle'

import { Button } from '@components'

function IntAlertDialog({
  open = false,
  onClose = (
    _event: any,
    _reason?: boolean | 'backdropClick' | 'escapeKeyDown',
  ) => {},
  title = '',
  content = '',
  ...rest
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="alert-dialog-title"
      aria-describedby="alert-dialog-description"
      {...rest}
    >
      {title && <DialogTitle id="alert-dialog-title">{title}</DialogTitle>}
      <DialogContent>
        <DialogContentText id="alert-dialog-description">
          {content}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={(e: any) => onClose(e, false)} color="secondary">
          Disagree
        </Button>
        <Button
          onClick={(e: any) => onClose(e, true)}
          color="primary"
          autoFocus
        >
          Agree
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default IntAlertDialog
