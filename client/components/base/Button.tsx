import React from 'react'
import classnames from 'classnames'
import { makeStyles } from '@material-ui/core/styles'
import Button from '@material-ui/core/Button'
import CircularProgress from '@material-ui/core/CircularProgress'

const useStyles = makeStyles({
  buttonContent: {
    transition: 'opacity 0.3s ease',
  },
  loading: {
    opacity: 0,
  },
  progress: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -10,
    marginTop: -10,
    animationDuration: '750ms',
  },
})

function IntButton({ isLoading = false, children = '', ...props }) {
  const classes = useStyles()
  return (
    <Button disabled={isLoading} {...props}>
      <div
        className={classnames(classes.buttonContent, {
          [classes.loading]: isLoading,
        })}
      >
        {children}
      </div>
      {isLoading && (
        <CircularProgress
          variant="indeterminate"
          disableShrink
          size={20}
          className={classes.progress}
          thickness={4}
        />
      )}
    </Button>
  )
}

export default React.memo(IntButton)
