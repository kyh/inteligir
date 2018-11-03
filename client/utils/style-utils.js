import { css } from 'styled-components';

export function textOverflow() {
  return `
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `;
}

export const media = {
  mobile: (...args) => css`
    @media (max-width: 768px) {
      ${css(...args)};
    }
  `,
};
