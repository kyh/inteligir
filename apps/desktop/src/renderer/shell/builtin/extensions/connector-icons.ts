// Brand-mark SVG path data (24×24 viewBox) for catalog connectors, sourced from
// simple-icons and keyed by connector id. The card renders the glyph in white on
// the connector's accent tile, falling back to a monogram when an id is absent.

import {
  siAsana,
  siAtlassian,
  siCloudflare,
  siGithub,
  siGmail,
  siGooglecalendar,
  siGoogledocs,
  siGoogledrive,
  siGooglesheets,
  siHuggingface,
  siIntercom,
  siLinear,
  siNotion,
  siPaypal,
  siSentry,
  siStripe,
} from "simple-icons";

export const CONNECTOR_ICON_PATHS: Record<string, string> = {
  github: siGithub.path,
  linear: siLinear.path,
  notion: siNotion.path,
  sentry: siSentry.path,
  atlassian: siAtlassian.path,
  asana: siAsana.path,
  intercom: siIntercom.path,
  stripe: siStripe.path,
  paypal: siPaypal.path,
  cloudflare: siCloudflare.path,
  huggingface: siHuggingface.path,
  gmail: siGmail.path,
  google_calendar: siGooglecalendar.path,
  google_drive: siGoogledrive.path,
  google_docs: siGoogledocs.path,
  google_sheets: siGooglesheets.path,
};
