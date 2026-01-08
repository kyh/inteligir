import type { TAudioElement } from 'platejs';
import { SlateElement, type SlateElementProps } from 'platejs/static';
import * as React from 'react';

export function MediaAudioElementStatic(
  props: SlateElementProps<TAudioElement>
) {
  const { url } = props.element;

  return (
    <SlateElement className="mb-1" {...props}>
      <figure className="group relative cursor-default">
        <div className="h-16">
          <audio className="size-full" controls src={url} />
        </div>
      </figure>
      {props.children}
    </SlateElement>
  );
}
