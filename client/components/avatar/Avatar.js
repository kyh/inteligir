// @flow
import React from 'react';
import styled from 'styled-components';
import { SIZE } from '@client/utils/style-utils';
import AvatarImage from './AvatarImage';
import AvatarInfo from './AvatarInfo';

function getAvatarPxSize(size) {
  switch (size) {
    case SIZE.default:
      return '38px';
    case SIZE.small:
      return '28px';
    case SIZE.large:
      return '60px';
    case SIZE.jumbo:
      return '120px';
    default:
      return '38px';
  }
}

function getStatusSize(size) {
  switch (size) {
    case SIZE.default:
      return '10px';
    case SIZE.small:
      return '6px';
    case SIZE.large:
      return '15px';
    case SIZE.jumbo:
      return '20px';
    default:
      return '10px';
  }
}

const StyledAvatarContainer = styled.div`
  display: inline-block;
  position: relative;
  height: ${(props) => getAvatarPxSize(props.size)};
  width: ${(props) => getAvatarPxSize(props.size)};
`;

const StyledAvatarAction = styled.div`
  position: absolute;
  bottom: 0;
  right: 0;
`;

const StyledAvatarStatus = styled.div`
  position: absolute;
  bottom: 0;
  right: 0;
  background: ${(props) => props.theme[props.status]};
  height: ${(props) => getStatusSize(props.size)};
  width: ${(props) => getStatusSize(props.size)};
  border-radius: 50%;
  border: 1px solid #fff;
`;

export type AvatarProps = {
  name?: React.node,
  status?: String,
  imgUrl?: String,
  textTop?: String,
  highlighted?: Boolean,
  textBottom?: React.node,
  actionIcon?: React.node,
  size?: $Keys<typeof SIZE>,
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
  <>
    <StyledAvatarContainer size={size}>
      <AvatarImage imgUrl={imgUrl} />
      {actionIcon && <StyledAvatarAction>{actionIcon}</StyledAvatarAction>}
      {status && <StyledAvatarStatus status={status} size={size} />}
    </StyledAvatarContainer>
    {name && (
      <AvatarInfo
        name={name}
        textTop={textTop}
        textBottom={textBottom}
        size={size}
        highlighted={highlighted}
      />
    )}
  </>
);

Avatar.defaultProps = {
  name: null,
  textTop: null,
  textBottom: null,
  actionIcon: null,
  highlighted: false,
  status: null,
  imgUrl: null,
  size: SIZE.default,
};

export default Avatar;
