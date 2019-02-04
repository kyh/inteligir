import React from 'react';
import styled from 'styled-components';
import NProgress from 'nprogress';
import Router from 'next/router';
import Link from 'next/link';

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
  padding: ${({ theme }) => theme.baseSpacing2};
  background: ${({ theme }) => theme.brandBlack1};

  .left {
    display: flex;
    align-items: center;
    font-size: 2.2rem;
  }

  .nav-logo {
    display: flex;
    margin-right: ${({ theme }) => theme.baseSpacing4};
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
    margin-right: ${({ theme }) => theme.baseSpacing4};
    border: 0;

    &:hover,
    &.active {
      color: ${({ theme }) => theme.brandCyanDark};
    }
  }
`;

const Navigation = () => (
  <StyledHeader>
    <div className="left">
      <Link href="/">
        <a className="nav-logo">
          <Logo />
        </a>
      </Link>
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
