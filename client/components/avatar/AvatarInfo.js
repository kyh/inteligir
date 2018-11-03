import React from 'react';
import styled from 'styled-components';
import { textOverflow } from '@client/utils/style-utils';

export const StyledAvatarInfo = styled.div`
  margin-left: 1rem;
  flex-grow: 1;
  & > * {
    display: block;
  }
`;

export const StyledName = styled.span.attrs({
  className: 'name',
})`
  font-size: 1.4rem;
  color: ${(props) => props.theme['title-color']};
  line-height: 2.2rem;
  ${textOverflow()};
`;

export const StyledTextTop = styled.span.attrs({
  className: 'text-top',
})`
  font-size: 1.2rem;
  color: ${(props) => props.theme['text-color']};
  line-height: 1.8rem;
  ${textOverflow()};
`;

export const StyledTextBottom = styled.span.attrs({
  className: 'text-bottom',
})`
  font-size: 1.2rem;
  color: ${(props) => props.theme['text-color']};
  line-height: 1.8rem;
  margin-top: 2px;
  ${textOverflow()};
`;

type AvatarInfoProps = {
  name?: React.node,
  textTop?: String,
  textBottom?: String,
};

const AvatarInfo = ({ name, textTop, textBottom }: AvatarInfoProps) => (
  <StyledAvatarInfo>
    {textTop && <StyledTextTop>{textTop}</StyledTextTop>}
    {name && <StyledName>{name}</StyledName>}
    {textBottom && <StyledTextBottom>{textBottom}</StyledTextBottom>}
  </StyledAvatarInfo>
);

AvatarInfo.defaultProps = {
  name: null,
  textTop: null,
  textBottom: null,
};

export default AvatarInfo;
