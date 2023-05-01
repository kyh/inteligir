"use client";

import { Suspense } from "react";
import type { i18n } from "i18next";
import { I18nextProvider } from "react-i18next";

import isBrowser from "~/core/generic/is-browser";

let client: i18n;

function I18nProvider(
  props: React.PropsWithChildren<{
    lang?: string;
  }>
) {
  return (
    <Suspense>
      <I18nInitializer lang={props.lang}>{props.children}</I18nInitializer>
    </Suspense>
  );
}

export default I18nProvider;

function I18nInitializer(
  props: React.PropsWithChildren<{
    lang?: string;
  }>
) {
  if (!client || client.language !== props.lang) {
    throw withI18nClient(props.lang);
  }

  return <I18nextProvider i18n={client}>{props.children}</I18nextProvider>;
}

async function withI18nClient(lang?: string) {
  if (isBrowser()) {
    const { default: initialize18n } = await import("~/i18n/i18n.client");

    client = await initialize18n(lang);
  } else {
    const { default: initialize18n } = await import("~/i18n/i18n.server");

    client = await initialize18n(lang);
  }
}
