import React from 'react';
import styled from 'styled-components';
import { color, space, themeGet } from 'styled-system';
import NextLink from 'next/link';

import defaultTheme from '@client/utils/theme';

const StyledLink = styled.a`
  ${color};
  text-decoration: none;
  background-color: transparent;
  -webkit-text-decoration-skip: objects;
  border-bottom: 1px solid ${themeGet('colors.borderGray')};
  transition: color 0.2s linear, border-color 0.2s linear;
  cursor: pointer;

  &:hover {
    border-bottom-color: ${({ theme, color }) => theme.colors[color]};
  }
`;

StyledLink.displayName = 'Link';

StyledLink.propTypes = {
  ...color.propTypes,
};

StyledLink.defaultProps = {
  theme: defaultTheme,
  color: 'blue',
};

const Link = ({ children, href, ...props }) => (
  <NextLink href={href}>
    <StyledLink {...props}>{children}</StyledLink>
  </NextLink>
);

Link.Block = styled(Link)`
  display: block;
  color: inherit;
  border: none;
  transition: opacity 0.2s ease;
  ${space}

  &:hover {
    opacity: 0.8;
  }
`;

export default Link;
