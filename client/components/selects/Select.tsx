import React from 'react'
import { withStyles } from '@material-ui/core/styles'
import Select from '@material-ui/core/Select'
import InputLabel from '@material-ui/core/InputLabel'
import FormControl from '@material-ui/core/FormControl'
import FormHelperText from '@material-ui/core/FormHelperText'

const styles = (theme) => ({
  root: {
    display: 'flex',
  },
  formControl: {},
})

function SelectGroup({ classes, label, helperText, children, ...props }) {
  return (
    <FormControl className={classes.formControl}>
      {label && <InputLabel htmlFor="age-native-simple">{label}</InputLabel>}
      <Select {...props}>{children}</Select>
      {helperText && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  )
}

export default withStyles(styles)(SelectGroup)
