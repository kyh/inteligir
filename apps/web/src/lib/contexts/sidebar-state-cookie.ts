import { cookies } from 'next/headers';

const SIDEBAR_STATE_COOKIE_NAME = 'sidebarState';

export const parseSidebarStateCookie = () => cookies().get(SIDEBAR_STATE_COOKIE_NAME)?.value;
