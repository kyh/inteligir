import React from 'react';
import styled from 'styled-components';
import AvatarStatus from './AvatarStatus';
import AvatarImage from './AvatarImage';
import AvatarInfo from './AvatarInfo';

const StyledAvatar = styled.div`
  display: flex;
  align-items: center;
  ${(props) =>
    props.highlighted &&
    `
    .name {
      font-weight: 500;
    }
  `}

  ${(props) =>
    props.size === 'small' &&
    `
    .avatar-container {
      height: 28px;
      width: 28px;
    }
  `}

  ${(props) =>
    props.size === 'large' &&
    `
    .avatar-container {
      height: 60px;
      width: 60px;
    }
    .name {
      font-size: 1.7rem;
    }
  `}

  ${(props) =>
    props.size === 'larger' &&
    `
    .avatar-container {
      height: 80px;
      width: 80px;
    }
    .name {
      font-size: 2rem;
    }
  `}

  ${(props) =>
    props.size === 'extraLarge' &&
    `
    .avatar-container {
      height: 100px;
      width: 100px;
    }
    .name {
      font-size: 2rem;
    }
  `}

  ${(props) =>
    props.size === 'jumbo' &&
    `
    .avatar-container {
      height: 120px;
      width: 120px;
    }
  `}
`;

const StyledAvatarContainer = styled.div.attrs({
  className: 'avatar-container',
})`
  position: relative;
  height: 38px;
  width: 38px;
  flex-shrink: 0;
`;

const StyledAvatarAction = styled.div`
  position: absolute;
  bottom: 0;
  right: 0;
`;

export type AvatarProps = {
  name?: React.node,
  status?: React.node,
  imgUrl?: String | Array<String>,
  textTop?: String,
  highlighted?: Boolean,
  textBottom?: React.node,
  actionIcon?: React.node,
  size?: 'small' | 'large' | 'larger' | 'extraLarge' | 'jumbo',
};

const Avatar = ({
  name,
  imgUrl,
  textTop,
  highlighted,
  actionIcon,
  status,
  size,
  textBottom,
}: AvatarProps) => (
  <StyledAvatar highlighted={highlighted} size={size}>
    <StyledAvatarContainer>
      <AvatarImage imgUrl={imgUrl} />
      {actionIcon && <StyledAvatarAction>{actionIcon}</StyledAvatarAction>}
    </StyledAvatarContainer>
    {name && (
      <AvatarInfo name={name} textTop={textTop} textBottom={textBottom} />
    )}
    {status && <AvatarStatus status={status} />}
  </StyledAvatar>
);

Avatar.defaultProps = {
  name: null,
  textTop: null,
  textBottom: null,
  actionIcon: null,
  highlighted: false,
  status: null,
  imgUrl: null,
  size: null,
};

export default Avatar;
