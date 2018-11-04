import React from 'react';
import styled, { keyframes } from 'styled-components';

const bounce = keyframes`
  0%,
  80%,
  100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
`;

export const StyledLoadingDots = styled.div`
  display: inline-block;
  width: 70px;
  text-align: center;
  & > div {
    width: 7px;
    height: 7px;
    background-color: white;
    border-radius: 100%;
    vertical-align: middle;
    display: inline-block;
    animation: ${bounce} 1s infinite ease-in-out both;

    &:nth-child(1) {
      animation-delay: -0.32s;
      margin-right: 2px;
    }

    &:nth-child(2) {
      animation-delay: -0.16s;
      margin-right: 2px;
    }
  }
`;

const LoadingDots = (props) => (
  <StyledLoadingDots {...props}>
    <div />
    <div />
    <div />
  </StyledLoadingDots>
);

export default LoadingDots;
