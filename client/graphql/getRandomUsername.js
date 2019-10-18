import gql from 'graphql-tag';

const GET_RANDOM_DISPLAYNAME = gql`
  {
    randomDisplayName
  }
`;

export default GET_RANDOM_DISPLAYNAME;
