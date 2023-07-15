import type UserSession from "~/core/session/types/user-session";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/Avatar";

type ProfileAvatarProps =
  | {
      user: Maybe<UserSession>;
    }
  | {
      text: Maybe<string>;
    };

const ProfileAvatar: React.FCC<ProfileAvatarProps> = (props) => {
  if ("user" in props && props.user) {
    const photoUrl = props.user.data?.photoUrl;

    return (
      <Avatar>
        {photoUrl ? <AvatarImage src={photoUrl} /> : null}
        <AvatarFallback>{getUserInitials(props.user)}</AvatarFallback>
      </Avatar>
    );
  }

  if ("text" in props && props.text) {
    return (
      <Avatar>
        <AvatarFallback>{props.text[0]}</AvatarFallback>
      </Avatar>
    );
  }

  return null;
};

const getUserInitials = (session: Maybe<UserSession>) => {
  const displayName = getDisplayName(session);

  return displayName[0] ?? "";
};

const getDisplayName = (session: Maybe<UserSession>) => {
  if (!session) {
    return "";
  }

  const email = session.auth?.user.email;

  return session.data?.displayName ?? email ?? "";
};

export default ProfileAvatar;
