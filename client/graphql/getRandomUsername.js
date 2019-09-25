import gql from 'graphql-tag';

const GET_RANDOM_USERNAME = gql`
  {
    randomUsername
  }
`;

export default GET_RANDOM_USERNAME;
