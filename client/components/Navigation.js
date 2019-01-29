import React from 'react';
import styled from 'styled-components';
import NProgress from 'nprogress';
import Router from 'next/router';

import theme from '@client/utils/theme';
import Logo from '@client/components/Logo';
import ActiveLink from '@client/components/ActiveLink';

Router.onRouteChangeStart = () => {
  NProgress.start();
};
Router.onRouteChangeComplete = () => {
  NProgress.done();
};

Router.onRouteChangeError = () => {
  NProgress.done();
};

const StyledHeader = styled.header`
  display: flex;
  justify-content: space-between;
  padding: ${theme.baseSpacing2};
  background: ${theme.brandBlack1};

  .left {
    display: flex;
    align-items: center;
    font-size: 2.2rem;
  }

  .logo {
    width: 30px;
    height: 30px;
    margin-right: ${theme.baseSpacing4};
  }
`;

const StyledNav = styled.nav`
  a {
    color: #fff;
    margin-right: ${theme.baseSpacing4};
    border: 0;

    &.active {
      color: ${theme.brandCyanDark};
    }
  }
`;

const Navigation = () => (
  <StyledHeader>
    <div className="left">
      <Logo />
      <StyledNav>
        <ActiveLink href="/discover" prefetch>
          <a>Discover</a>
        </ActiveLink>
        <ActiveLink href="/community" prefetch>
          <a>Community</a>
        </ActiveLink>
        <ActiveLink href="/help" prefetch>
          <a>Help</a>
        </ActiveLink>
      </StyledNav>
    </div>
    <div className="right" />
  </StyledHeader>
);

export default Navigation;
