import React from 'react';
import styled from 'styled-components';

const StyledAvatarThumbnail = styled.img.attrs({
  className: 'avatar',
})`
  height: 100%;
  width: 100%;
  border-radius: 50%;
  display: block;
  & + * {
    margin-left: 0.75rem;
  }
`;

const StyledAvatarMultiContainer = styled.div`
  height: 100%;
  width: 100%;
  border-radius: 50%;
  overflow: hidden;
  display: flex;

  ${(props) =>
    props.length === 2 &&
    `
    & > .avatar {
      transform: translateX(-50%);
    }
  `}

  ${(props) =>
    props.length === 3 &&
    `
    &:nth-child(1) {
      transform: translateX(-50%);
    }
    &:nth-child(2),
    &:nth-child(3) {
      height: 50%;
      width: 50%;
    }
    &:nth-child(2) {
      transform: translateX(-100%);
    }
    &:nth-child(3) {
      transform: translateX(-200%) translateY(100%);
    }
  `}

  ${(props) =>
    props.length >= 4 &&
    `
    flex-wrap: wrap;
    & > .avatar {
      height: 50%;
      width: 50%;
    }
  `}
`;

type AvatarImageProps = {
  name?: React.node,
  imgUrl: String | Array<AvatarImageProps>,
};

const AvatarImage = ({ imgUrl, name }: AvatarImageProps) =>
  Array.isArray(imgUrl) ? (
    /* GROUPS, rendering multiple images */
    <StyledAvatarMultiContainer length={imgUrl.length}>
      {imgUrl.slice(0, 4).map((d) => (
        <StyledAvatarThumbnail
          key={d.imgUrl}
          alt={typeof d.name === 'string' ? d.name : ''}
          src={d.imgUrl}
        />
      ))}
    </StyledAvatarMultiContainer>
  ) : (
    /* Single */
    <StyledAvatarThumbnail
      alt={typeof name === 'string' ? name : ''}
      src={imgUrl}
    />
  );

AvatarImage.defaultProps = {
  name: null,
};

export default AvatarImage;
