import React from 'react';
import baseTheme from '@client/utils/theme';
import styled, {
  ThemeProvider as StyledThemeProvider,
  injectGlobal,
} from 'styled-components';

injectGlobal`body {
  margin: 0;
}`;

export const Base = styled.div`
  font-family: ${(props) => props.theme.font};
  line-height: 1.4;

  * {
    box-sizing: border-box;
  }
`;

const ThemeProvider = (props) => {
  return (
    <StyledThemeProvider theme={baseTheme}>
      <Base {...props} />
    </StyledThemeProvider>
  );
};

export default ThemeProvider;
