import React, { Children } from 'react';
import styled from 'styled-components';
import { color } from 'styled-system';
import NextLink from 'next/link';

import theme from './theme';

const StyledLink = styled.a`
  cursor: pointer;
  text-decoration: none;
  ${color} &:hover {
    text-decoration: underline;
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
    <StyledLink {...props}>
      {React.cloneElement(Children.only(children))}
    </StyledLink>
  </NextLink>
);

export default Link;
