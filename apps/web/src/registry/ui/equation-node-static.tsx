import { getEquationHtml } from '@platejs/math';

import type { TEquationElement } from 'platejs';
import { SlateElement, type SlateElementProps } from 'platejs/static';
import * as React from 'react';

import { cn } from '@/lib/utils';

export function EquationElementStatic(
  props: SlateElementProps<TEquationElement>
) {
  const element = props.element;

  const html = getEquationHtml({
    element,
    options: {
      displayMode: true,
      errorColor: '#cc0000',
      fleqn: false,
      leqno: false,
      macros: { '\\f': '#1f(#2)' },
      output: 'htmlAndMathml',
      strict: 'warn',
      throwOnError: false,
      trust: false,
    },
  });

  return (
    <SlateElement className="my-1" {...props}>
      <div
        className={cn(
          'flex select-none items-center justify-center rounded-sm',
          element.texExpression.length === 0 ? 'bg-muted p-3' : 'px-2 py-1'
        )}
      >
        <span
          dangerouslySetInnerHTML={{
            __html: html,
          }}
        />
      </div>
      {props.children}
    </SlateElement>
  );
}

export function InlineEquationElementStatic(
  props: SlateElementProps<TEquationElement>
) {
  const element = props.element;

  const html = getEquationHtml({
    element,
    options: {
      displayMode: true,
      errorColor: '#cc0000',
      fleqn: false,
      leqno: false,
      macros: { '\\f': '#1f(#2)' },
      output: 'htmlAndMathml',
      strict: 'warn',
      throwOnError: false,
      trust: false,
    },
  });

  return (
    <SlateElement
      className="inline-block select-none rounded-sm [&_.katex-display]:my-0"
      {...props}
    >
      <div
        className={cn(
          'after:-top-0.5 after:-left-1 after:absolute after:inset-0 after:z-1 after:h-[calc(100%)+4px] after:w-[calc(100%+8px)] after:rounded-sm after:content-[""]',
          'h-6',
          element.texExpression.length === 0 &&
            'text-muted-foreground after:bg-neutral-500/10'
        )}
      >
        <span
          className={cn(
            element.texExpression.length === 0 && 'hidden',
            'font-mono leading-none'
          )}
          dangerouslySetInnerHTML={{
            __html: html,
          }}
        />
      </div>
      {props.children}
    </SlateElement>
  );
}
