import { useMutation } from '@apollo/react-hooks';
import gql from 'graphql-tag';

export const SIGNUP = gql`
  mutation Signup($email: String, $password: String!) {
    signup(email: $email, password: $password) {
      token
      user {
        id
        email
      }
    }
  }
`;

export function useSignup() {
  return useMutation(SIGNUP);
}
