import gql from 'graphql-tag';

const SIGNUP = gql`
  mutation Signup($displayName: String!, $email: String, $password: String!) {
    signup(displayName: $displayName, email: $email, password: $password) {
      id
      displayName
      email
    }
  }
`;

export default SIGNUP;
