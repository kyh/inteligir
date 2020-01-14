import { useMutation } from '@apollo/react-hooks';
import gql from 'graphql-tag';

export const CREATE_PLAYLIST = gql`
  mutation CreatePlaylist($description: String!) {
    createPlaylist(description: $description) {
      id
      description
    }
  }
`;

export function useCreatePlaylist() {
  return useMutation(CREATE_PLAYLIST);
}
