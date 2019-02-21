import React from 'react';
import styled from 'styled-components';
import {
  FooterBackground,
  FacebookIcon,
  GoogleIcon,
  TwitterIcon,
  Container,
} from '@client/components';

const StyledFooter = styled.footer`
  position: relative;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: 0;

  .footer-inner {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    padding-top: 32px;
    padding-bottom: 32px;

    &::before {
      content: '';
      left: 0;
      width: 100%;
      display: block;
      height: 1px;
      background: rgba(69, 76, 76, 0.5);
      position: absolute;
      top: 0;
    }
  }

  .footer-copyright,
  .footer-social-links {
    flex: none;
    width: 100%;
    display: inline-flex;
    justify-content: center;
  }
  .footer-copyright {
    margin-bottom: 24px;
  }
  .footer-social-links {
    margin-bottom: 0;
  }
  .footer-social-links li {
    display: inline-flex;
  }
  .footer-social-links li + li {
    margin-left: 16px;
  }
  .footer-social-links li a {
    padding: 8px;
  }

  @media (min-width: 641px) {
    justify-content: space-between;
    .footer-copyright,
    .footer-social-links {
      flex: 50%;
    }
    .footer-copyright {
      margin-bottom: 0;
      justify-content: flex-start;
    }
    .footer-social-links {
      justify-content: flex-end;
    }
  }
`;

const Footer = () => (
  <StyledFooter>
    <FooterBackground />
    <Container maxWidth={1128} px={24}>
      <div className="footer-inner">
        <div className="footer-copyright">
          © 2019 Inteligir, all rights reserved
        </div>
        <ul className="footer-social-links list-reset">
          <li>
            <a href="#">
              <span className="screen-reader-text">Facebook</span>
              <FacebookIcon />
            </a>
          </li>
          <li>
            <a href="#">
              <span className="screen-reader-text">Twitter</span>
              <TwitterIcon />
            </a>
          </li>
          <li>
            <a href="#">
              <span className="screen-reader-text">Google</span>
              <GoogleIcon />
            </a>
          </li>
        </ul>
      </div>
    </Container>
  </StyledFooter>
);

export default Footer;
