import { getUserDataById } from "~/lib/server/queries";
import getSupabaseServerClient from "~/core/supabase/server-client";
import initializeServerI18n from "~/i18n/i18n.server";
import getLanguageCookie from "~/i18n/get-language-cookie";

/**
 * @name loadUserData
 * @description Loads the user's data from Supabase Auth and Database
 */
async function loadUserData() {
  const client = getSupabaseServerClient();

  try {
    const { data, error } = await client.auth.getSession();

    if (!data.session || error) {
      return emptyUserData();
    }

    const userId = data.session.user.id;
    const userData = await getUserDataById(client, userId);
    const language = await getLanguage();
    const accessToken = data.session.access_token;

    return {
      accessToken,
      language,
      auth: data.session,
      data: userData || undefined,
      role: undefined,
    };
  } catch (e) {
    return emptyUserData();
  }
}

async function emptyUserData() {
  const language = await getLanguage();

  return {
    accessToken: undefined,
    language,
    auth: undefined,
    data: undefined,
    role: undefined,
  };
}

export default loadUserData;

async function getLanguage() {
  const { language } = await initializeServerI18n(getLanguageCookie());

  return language;
}
