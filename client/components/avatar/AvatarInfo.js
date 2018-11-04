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

export const StyledName = styled.span`
  font-size: 1.4rem;
  color: ${(props) => props.theme['title-color']};
  font-weight: ${(props) => (props.highlighted ? '500' : '400')}
  line-height: 2.2rem;
  ${textOverflow()};
`;

export const StyledTextTop = styled.span`
  font-size: 1.2rem;
  color: ${(props) => props.theme['text-color']};
  line-height: 1.8rem;
  ${textOverflow()};
`;

export const StyledTextBottom = styled.span`
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
  highlighted?: Boolean,
};

const AvatarInfo = ({
  name,
  textTop,
  textBottom,
  highlighted,
}: AvatarInfoProps) => (
  <StyledAvatarInfo>
    {textTop && <StyledTextTop>{textTop}</StyledTextTop>}
    {name && <StyledName highlighted={highlighted}>{name}</StyledName>}
    {textBottom && <StyledTextBottom>{textBottom}</StyledTextBottom>}
  </StyledAvatarInfo>
);

AvatarInfo.defaultProps = {
  name: null,
  textTop: null,
  textBottom: null,
  highlighted: false,
};

export default AvatarInfo;
