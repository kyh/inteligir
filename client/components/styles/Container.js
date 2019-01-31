import styled from 'styled-components';

const Container = styled.section`
  padding: ${({ theme }) => theme.baseSpacing2};
  max-width: ${({ theme }) => theme.container};
  margin: 0 auto;
`;

export default Container;
