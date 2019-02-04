import React from 'react';
import styled from 'styled-components';
import { color } from 'styled-system';
import NextLink from 'next/link';

import theme from '@client/utils/theme';

const StyledLink = styled.a`
  ${color};
  text-decoration: none;
  background-color: transparent;
  -webkit-text-decoration-skip: objects;
  border-bottom: 1px solid ${theme.colors.borderGray};
  transition: color 0.2s linear, border-color 0.2s linear;
  cursor: pointer;

  &:hover {
    border-bottom-color: ${theme.colors.darkBlue};
  }

  &:not([href]):not([tabindex]) {
    color: inherit;
    text-decoration: none;
  }

  &:not([href]):not([tabindex]):hover,
  &:not([href]):not([tabindex]):focus {
    color: inherit;
    text-decoration: none;
  }

  &:not([href]):not([tabindex]):focus {
    outline: 0;
  }
`;

StyledLink.displayName = 'Link';

StyledLink.propTypes = {
  ...color.propTypes,
};

StyledLink.defaultProps = {
  color: 'blue',
  theme,
};

const Link = ({ children, href, ...props }) => (
  <NextLink href={href}>
    <StyledLink {...props}>{children}</StyledLink>
  </NextLink>
);

export default Link;
