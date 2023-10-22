import { Avatar, AvatarFallback, AvatarImage } from "@inteligir/ui";
import type UserSession from "@/lib/session/types/user-session";

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

  return (
    session.data?.displayName ??
    session.auth?.user.email ??
    session.auth?.user.phone ??
    ""
  );
};

export default ProfileAvatar;
