import { useMutation } from '@apollo/react-hooks';
import gql from 'graphql-tag';

export const GET_COURSE = gql`
  query Course($id: ID!) {
    course(where: { id: $id }) {
      id
      description
    }
  }
`;

export function useGetCourse() {
  return useMutation(GET_COURSE);
}
