import { useMutation } from '@apollo/react-hooks';
import gql from 'graphql-tag';

export const LOGOUT = gql`
  mutation Logout {
    logout {
      token
    }
  }
`;

export function useLogout() {
  return useMutation(LOGOUT);
}
