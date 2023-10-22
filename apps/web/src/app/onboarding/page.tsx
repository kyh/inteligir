import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import OnboardingContainer from './components/OnboardingContainer';
import requireSession from '~/lib/user/require-session';
import getSupabaseServerClient from '~/core/supabase/server-client';
import { getUserDataById } from '~/lib/server/queries';
import { withI18n } from '~/i18n/with-i18n';
import configuration from '~/configuration';

export const metadata = {
  title: 'Onboarding',
};

async function OnboardingPage() {
  const { csrfToken } = await loadData();

  return <OnboardingContainer csrfToken={csrfToken} />;
}

export default withI18n(OnboardingPage);

async function loadData() {
  const client = getSupabaseServerClient();
  const session = await requireSession(client);
  const user = session.user;

  const csrfToken = headers().get('X-CSRF-Token');

  const userData = await getUserDataById(client, user.id);

  // if we cannot find the user's Database record
  // the user should go to the onboarding flow
  // so that the record wil be created after the end of the flow
  if (!userData) {
    return {
      csrfToken,
    };
  }

  // if the user has already been onboarded
  const onboarded = userData.onboarded;

  // there are two cases when we redirect the user to the onboarding
  // 1. if they have not been onboarded yet
  // 2. if they end up with 0 organizations (for example, if they get removed)
  //
  // NB: you should remove this if you want to
  // allow organization-less users within the application
  if (onboarded) {
    redirect(configuration.paths.appHome);
  }

  return {
    csrfToken,
  };
}
