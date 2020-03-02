import createMuiTheme from '@material-ui/core/styles/createMuiTheme'

export default createMuiTheme({
  palette: {
    primary: {
      // light: will be calculated from palette.primary.main,
      main: '#1865F2',
      // dark: will be calculated from palette.primary.main,
      // contrastText: will be calculated to contrast with palette.primary.main
    },
    secondary: {
      // light: will be calculated from palette.secondary.main,
      main: '#3B475F',
      // dark: will be calculated from palette.secondary.main,
      // contrastText: will be calculated to contrast with palette.secondary.main
    },
    // error: will use the default color
    background: {
      default: '#FFFFFF',
    },
  },
  typography: {
    fontSize: 16,
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
      '"Apple Color Emoji"',
      '"Segoe UI Emoji"',
      '"Segoe UI Symbol"',
    ].join(','),
    body1: {
      lineHeight: 1.65,
    },
    subtitle1: {
      fontWeight: 500,
      fontSize: '0.875rem',
      lineHeight: 1.57,
      letterSpacing: '0.00714em',
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
    },
    overline: {
      color: '#626b7f',
      fontWeight: 700,
    },
    h1: {
      fontSize: '2.5rem',
      fontWeight: 700,
    },
    h2: {
      fontSize: '2rem',
      fontWeight: 700,
    },
    h3: {
      fontSize: '1.75rem',
      fontWeight: 700,
    },
    h4: {
      fontSize: '1.5rem',
      fontWeight: 700,
    },
    h5: {
      fontSize: '1.25rem',
      fontWeight: 700,
    },
    h6: {
      fontSize: '1rem',
      fontWeight: 700,
    },
  },
  overrides: {
    MuiFormHelperText: {
      contained: {
        margin: '8px 0 0',
        lineHeight: 1.4,
      },
    },
    MuiCircularProgress: {
      root: {
        animationDuration: '550ms !important',
      },
    },
    MuiPaper: {
      elevation1: {
        boxShadow:
          '0 3px 10px rgba(50, 50, 93, .11), 0 1px 2px rgba(0, 0, 0, .08)',
      },
    },
    MuiBackdrop: {
      root: {
        backgroundColor: 'rgba(59, 71, 95, 0.85)',
      },
    },
    MuiOutlinedInput: {
      root: {
        '& $notchedOutline': {
          borderWidth: 2,
          borderColor: '#3b475f1a',
        },
        '&:hover:not($disabled):not($focused):not($error) $notchedOutline': {
          borderColor: '#3b475f1a',
        },
      },
    },
    MuiButton: {
      contained: {
        boxShadow: '0 0 10px 0 rgba(224, 224, 224, 0.4);',
        '&:active': {
          boxShadow: '0 0 2px 0 rgba(224, 224, 224, 0.4);',
        },
        '&:hover': {
          boxShadow: '',
        },
      },
      containedPrimary: {
        boxShadow: '0 0 10px 0 rgba(131, 137, 225, 0.4);',
        '&:active': {
          boxShadow: '0 0 2px 0 rgba(131, 137, 225, 0.4);',
        },
      },
      containedSecondary: {
        boxShadow: '0 0 10px 0 rgba(57, 71, 97, 0.4);',
        '&:active': {
          boxShadow: '0 0 2px 0 rgba(57, 71, 97, 0.4);',
        },
      },
    },
  },
  brand: {
    black: '#242537',
    white: '#FFFFFF',
    background: '#F7F5F4',
    primary: '#1865f2',
    secondary: '#3B475F',
    backgroundBlue: '#E8F4F4',
    lightBlue: '#578FF5',
    blue: '#1865F2',
    darkBlue: '#0B2E6E',
    backgroundGreen: '#D6FCEE',
    lightGreen: '#1FA67A',
    green: '#12855F',
    darkGreen: '#006647',
    backgroundPink: '#FFE0E6',
    lightPink: '#FF7490',
    pink: '#FF5678',
    darkPink: '#D14763',
    backgroundRed: '#FBEBE9',
    lightRed: '#DF4F40',
    red: '#D92916',
    darkRed: '#B22213',
    backgroundYellow: '#FFF0D0',
    lightYellow: '#FFD52C',
    yellow: '#FFB100',
    darkYellow: '#D19100',
    backgroundPurple: '#EBEAFC',
    lightPurple: '#A8A3F4',
    purple: '#958FF2',
    darkPurple: '#7A76C7',
    // Positioning.
    maxWidth: 1200,
    borderColor: '#D6D8DA',
    boxShadow: '0 3px 10px rgba(50, 50, 93, .11), 0 1px 2px rgba(0, 0, 0, .08)',
  },
})
