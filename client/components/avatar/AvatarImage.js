import React from 'react';
import styled from 'styled-components';

const StyledAvatarThumbnail = styled.img`
  height: 100%;
  width: 100%;
  border-radius: 50%;
  display: block;
`;

type AvatarImageProps = {
  name?: React.node,
  imgUrl: String,
};

const AvatarImage = ({ imgUrl, name }: AvatarImageProps) => (
  <StyledAvatarThumbnail
    alt={typeof name === 'string' ? name : ''}
    src={imgUrl}
  />
);

AvatarImage.defaultProps = {
  name: null,
};

export default AvatarImage;
