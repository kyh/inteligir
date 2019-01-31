import styled from 'styled-components';

export const Card = styled.div`
  background-color: ${({ theme }) => theme.brandBlack};
  border-radius: 10px;
`;

export const CardHeader = styled.header`
  padding: ${({ theme }) => theme.baseSpacing2};
  font-weight: 500;
`;
