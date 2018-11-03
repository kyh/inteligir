import React from 'react';
import styled from 'styled-components';

const StyledAvatarStatus = styled.div`
  margin-left: 10px;
  text-align: right;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  color: ${(props) => props.theme['text-color']};
  font-size: 0.75rem;
`;

const StyledStatusOnline = styled.div`
  background: ${(props) => props.theme['brand-green']};
  height: 6px;
  width: 6px;
  border-radius: 50%;
`;

type AvatarStatusProps = {
  status: React.node,
};

const AvatarStatus = ({ status }: AvatarStatusProps) => (
  <StyledAvatarStatus>
    {status === 'online' ? <StyledStatusOnline /> : <span>{status}</span>}
  </StyledAvatarStatus>
);

export default AvatarStatus;
