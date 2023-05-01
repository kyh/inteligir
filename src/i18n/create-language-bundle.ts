const { resolve } = require("path");

function createLanguageBundle(language: string) {
  const prefix = `./public/locales`;

  const common = require(resolve(`${prefix}/${language}/common.json`));
  const auth = require(`${prefix}/${language}/auth.json`);
  const organization = require(`${prefix}/${language}/organization.json`);
  const profile = require(`${prefix}/${language}/profile.json`);
  const subscription = require(`${prefix}/${language}/subscription.json`);

  return {
    common,
    auth,
    organization,
    profile,
    subscription,
  };
}

export default createLanguageBundle;
