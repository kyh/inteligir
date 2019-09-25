import gql from 'graphql-tag';

const GET_CURRENT_USER = gql`
  {
    me {
      id
      email
      username
    }
  }
`;

export default GET_CURRENT_USER;
