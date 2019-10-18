import gql from 'graphql-tag';

const GET_CURRENT_USER = gql`
  {
    me {
      id
      email
      displayName
    }
  }
`;

export default GET_CURRENT_USER;
