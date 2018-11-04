// @flow
import React from 'react';
import styled from 'styled-components';
import { darken } from 'polished';
import LoadingDots from '@client/components/Loading';
import { SIZE, SHAPE, KIND } from '@client/utils/style-utils';

const buttonSize = (props) => {
  switch (props.size) {
    case SIZE.small:
      return `
        font-size: 1.3rem;
        height: 3rem;
        line-height: 3rem;
        padding: 0 2rem;
      `;
    case SIZE.large:
      return `
        font-size: 1.6rem;
        height: 5rem;
        line-height: 5rem;
        padding: 0 3rem;
      `;
    default:
      return `
        font-size: 1.4rem;
        height: 4rem;
        line-height: 4rem;
        padding: 0 2.4rem;
      `;
  }
};

const buttonShape = (props) => {
  switch (props.shape) {
    case SHAPE.round:
      return `
        border-radius: 50%;
      `;
    case SHAPE.pill:
      return `
        border-radius: 30px;
      `;
    default:
      return `
        border-radius: 5px;
      `;
  }
};

const buttonKind = (props) => {
  switch (props.kind) {
    case KIND.minimal:
      return `
        background: transparent;
        box-shadow: none;
        color: ${props.theme['brand-primary']}
        &:hover, &:active {
          background: ${props.theme['color-n-3']}
        }
      `;
    case KIND.plain:
      return `
        background: #fff;
        box-shadow: 0 1px 10px 0 rgba(0, 0, 0, 0.2);
        color: ${props.theme['text-color']}
        &:hover, &:active {
          background: ${props.theme['color-n-3']}
        }
      `;
    case KIND.blue:
      return `
        box-shadow: 0 2px 6px 0 rgba(0,118,255,0.39);
        color: #fff;
        background: ${props.theme['brand-primary']};
        &:hover, &:active {
          background: ${darken(0.1, props.theme['brand-primary'])}
        }
      `;
    // Primary kind.
    default:
      return `
        box-shadow: 0px 2px 6px 0 rgba(0, 0, 0, 0.2);
        color: #fff;
        background: ${props.theme['brand-black']};
        &:hover, &:active {
          background: ${darken(0.1, props.theme['brand-black'])}
        }
      `;
  }
};

const StyledButton = styled.button`
  position: relative;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: background 0.25s cubic-bezier(0.2, 0.8, 0.4, 1);
  ${buttonKind};
  ${buttonSize};
  ${buttonShape};
`;

const StyledButtonContent = styled.div`
  transition: 0.2s opacity;
  opacity: ${(props) => (props.isLoading ? 0 : 1)};
`;

const StyledLoadingDots = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
`;

type ButtonProps = {
  as?: React.ElementType,
  children?: React.node,
  type?: String,
  // appearence
  size?: $Keys<typeof SIZE>,
  shape?: $Keys<typeof SHAPE>,
  kind?: $Keys<typeof KIND>,
  // functionality
  isLoading?: Boolean,
  isDisabled?: Boolean,
  // icon properties
  icon?: React.node,
  iconRight?: Boolean,
};

export default class Button extends React.PureComponent<ButtonProps> {
  static defaultProps = {
    as: 'button',
    children: null,
    type: 'button',
    href: null,
    size: SIZE.default,
    shape: SHAPE.default,
    kind: KIND.primary,
    isLoading: false,
    isDisabled: false,
    icon: null,
    iconRight: false,
  };

  render() {
    const {
      children,
      type,
      isLoading,
      isDisabled,
      icon,
      iconRight,
      ...rest
    } = this.props;

    return (
      <StyledButton
        type={this.props.as === 'button' ? type : null}
        disabled={isLoading || isDisabled}
        {...rest}
      >
        {icon && (
          <StyledButtonContent isLoading={isLoading}>
            {icon}
          </StyledButtonContent>
        )}
        {isLoading && (
          <StyledLoadingDots>
            <LoadingDots />
          </StyledLoadingDots>
        )}
        <StyledButtonContent isLoading={isLoading}>
          {children}
        </StyledButtonContent>
      </StyledButton>
    );
  }
}
