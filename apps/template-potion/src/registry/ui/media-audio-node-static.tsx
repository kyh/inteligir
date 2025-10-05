import * as React from 'react';

import type { SlateElementProps, TAudioElement } from 'platejs';

import { SlateElement } from 'platejs';

export function MediaAudioElementStatic(
  props: SlateElementProps<TAudioElement>
) {
  const { url } = props.element;

  return (
    <SlateElement className="mb-1" {...props}>
      <figure className="group relative cursor-default">
        <div className="h-16">
          <audio className="size-full" src={url} controls />
        </div>
      </figure>
      {props.children}
    </SlateElement>
  );
}
