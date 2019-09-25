import gql from 'graphql-tag';

const SIGNUP = gql`
  mutation Signup($username: String!, $email: String, $password: String!) {
    signup(username: $username, email: $email, password: $password) {
      id
      username
      email
    }
  }
`;

export default SIGNUP;
