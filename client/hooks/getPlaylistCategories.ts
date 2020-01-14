import { useQuery } from '@apollo/react-hooks';
import gql from 'graphql-tag';

export const GET_PLAYLIST_CATEGORIES = gql`
  query GET_PLAYLIST_CATEGORIES {
    playlistCategories {
      id
      name
      description
      playlists
    }
  }
`;

export function useGetPlaylistCategories(options) {
  return useQuery(GET_PLAYLIST_CATEGORIES, options);
}
