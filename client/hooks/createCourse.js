import { useMutation } from '@apollo/react-hooks';
import gql from 'graphql-tag';

export const CREATE_COURSE = gql`
  mutation CreateCourse($content: String!) {
    createCourse(content: $content) {
      id
      content
    }
  }
`;

export function useCreateCourse() {
  return useMutation(CREATE_COURSE);
}
