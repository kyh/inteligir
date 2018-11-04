import React from 'react';
import styled from 'styled-components';
import LoadingDots from '@client/components/Loading';

type ButtonProps = {
  as?: React.ElementType,
  children?: React.node,
  type?: String,
  // appearence
  size?: 'small' | 'default' | 'large',
  appearance?: 'default' | 'primary' | 'minimal',
  intent?: 'none' | 'success' | 'warning' | 'danger',
  // functionality
  isLoading?: Boolean,
  isDisabled?: Boolean,
  // icon properties
  icon?: React.node,
  iconRight?: Boolean,
};

const StyledButton = styled.button`
  position: relative;
  display: inline-flex;
  align-items: center;
  padding: 8px 24px;
  background: #fff;
  font-size: 1.4rem;
  font-weight: 500;
  text-transform: uppercase;
  border-radius: 5px;
  box-shadow: #c7ced48a 0px 4px 14px 0px;
  border: none;
  outline: 0;
  cursor: pointer;

  & > .button-loading-dots {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
  }
`;

export default class Button extends React.PureComponent<ButtonProps> {
  static defaultProps = {
    as: 'button',
    children: null,
    type: 'button',
    href: null,
    size: 'default',
    appearance: 'default',
    intent: 'none',
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
        {icon && <div>{icon}</div>}
        {isLoading && <LoadingDots className="button-loading-dots" />}
        <div>{children}</div>
      </StyledButton>
    );
  }
}
