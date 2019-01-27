import React from 'react';
import styled from 'styled-components';
import Link from 'next/link';

import theme from '@client/utils/theme';
import Logo from '@client/components/Logo';

const StyledHeader = styled.header`
  display: flex;
  justify-content: space-between;
  padding: ${theme.baseSpacing2};
  background: ${theme.brandBlack1};

  .left {
    display: flex;
  }

  .logo {
    width: 30px;
    height: 30px;
  }
`;

const StyledNav = styled.nav``;

const Discover = () => (
  <section>
    <img
      src="/static/assets/discover.jpg"
      alt=""
      style={{
        width: '1440px',
        position: 'absolute',
        pointerEvents: 'none',
        opacity: '0.1',
      }}
    />
    <StyledHeader>
      <div className="left">
        <Logo />
        <StyledNav>
          <Link href="/discover">Store</Link>
          <Link href="/library">Library</Link>
          <Link href="/community">Community</Link>
        </StyledNav>
      </div>
      <div className="right" />
    </StyledHeader>
  </section>
);

export default Discover;
