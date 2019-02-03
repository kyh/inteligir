import React from 'react';
import styled, {
  ThemeProvider as StyledThemeProvider,
} from 'styled-components';
import nextTheme from '@client/utils/theme';

export const Base = styled.div`
  font-family: ${(props) => props.theme.font};
  line-height: ${(props) => props.theme.lineHeights.standard};
  font-weight: ${(props) => props.theme.fontWeights.medium};

  * {
    box-sizing: border-box;
  }
`;

const ThemeProvider = ({ ...props }) => {
  return (
    <StyledThemeProvider theme={nextTheme}>
      <Base {...props} />
    </StyledThemeProvider>
  );
};

export default ThemeProvider;
