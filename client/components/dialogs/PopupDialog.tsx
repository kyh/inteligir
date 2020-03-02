import React from 'react'
import Dialog from '@material-ui/core/Dialog'
import DialogTitle from '@material-ui/core/DialogTitle'

const IntPopupDialog = ({
  children = '',
  open = false,
  onClose = (
    _event: any,
    _reason?: boolean | 'backdropClick' | 'escapeKeyDown',
  ) => {},
  title = '',
  ...rest
}) => {
  return (
    <Dialog open={open} onClose={onClose} {...rest}>
      {title && <DialogTitle>{title}</DialogTitle>}
      {children}
    </Dialog>
  )
}

export default IntPopupDialog
