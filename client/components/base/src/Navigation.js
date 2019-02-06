import React from 'react';
import styled from 'styled-components';
import NProgress from 'nprogress';
import Router from 'next/router';
import { Logo, ActiveLink, Link } from '@client/components';
import { colors, space } from '@client/utils/theme';

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
  padding: ${space[3]}px;
  background: ${colors.black};

  .left {
    display: flex;
    align-items: center;
    font-size: 2.2rem;
  }

  .nav-logo {
    display: flex;
    margin-right: ${space[3]}px;
    border: 0;

    .logo {
      width: 30px;
      height: 30px;
    }
  }
`;

const StyledNav = styled.nav`
  a {
    color: #fff;
    margin-right: ${space[3]}px;
    border: 0;

    &:hover,
    &.active {
      color: ${colors.blue};
    }
  }
`;

const Navigation = () => (
  <StyledHeader>
    <div className="left">
      <Link href="/" className="nav-logo">
        <Logo />
      </Link>
      <StyledNav>
        <ActiveLink href="/discover" prefetch>
          Discover
        </ActiveLink>
        <ActiveLink href="/community" prefetch>
          Community
        </ActiveLink>
        <ActiveLink href="/help" prefetch>
          Help
        </ActiveLink>
      </StyledNav>
    </div>
    <div className="right" />
  </StyledHeader>
);

export default Navigation;
