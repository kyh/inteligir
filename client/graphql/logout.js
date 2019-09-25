import gql from 'graphql-tag';

const LOGOUT = gql`
  mutation Logout {
    logout {
      message
    }
  }
`;

export default LOGOUT;
