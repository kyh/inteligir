/** @jsxRuntime classic */
/** @jsx jsx */

import { jsx } from '@platejs/test-utils';

import { nid } from '@/lib/nid';

jsx;

export const linkValue: any = (
  <fragment>
    <hh2>🔗 Links</hh2>
    <hp>
      Try clicking the links below to navigate between pages and websites.
    </hp>
    <hp>Hover over any link to edit or copy its URL.</hp>
    <hp>
      <htext bold>Internal Links:</htext> Connect to other pages within your
      workspace
    </hp>
    <hp indent={1} listStyleType="decimal">
      <ha url="/ai">🧠 AI</ha>
    </hp>
    <hp indent={1} listStart={2} listStyleType="decimal">
      <ha id={nid()} url="/playground">
        🌳 Playground
      </ha>
    </hp>
    <hp indent={1} listStart={2} listStyleType="decimal">
      <ha id={nid()} url="/equation">
        🌳 Equation
      </ha>
    </hp>
    <hp>
      <htext bold>External Links:</htext> Connect to websites outside your
      workspace
    </hp>
    <hp indent={1} listStyleType="decimal">
      <ha id={nid()} url="https://google.com/">
        🔍 Google Search
      </ha>
    </hp>
    <hp indent={1} listStart={2} listStyleType="decimal">
      <ha id={nid()} url="https://github.com/">
        📦 GitHub Repository
      </ha>
    </hp>
  </fragment>
);
