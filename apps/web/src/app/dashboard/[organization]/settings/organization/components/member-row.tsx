import MinusIcon from "@heroicons/react/24/outline/minus-icon";

import type MembershipRole from "@/lib/organizations/types/membership-role";
import Button from "@inteligir/ui/button";
import TextField from "@inteligir/ui/text-field";

import MembershipRoleSelector from "./membership-role-selector";

interface Member {
  email: string;
  role: MembershipRole;
}

const MemberRow: React.FCC<{
  member: Member;
  memberRemoved: (member: Member) => void;
}> = ({ member, memberRemoved }) => {
  return (
    <div
      key={member.email}
      className={"space-between flex items-center space-x-1"}
    >
      <div className={"w-7/12"}>
        <TextField.Input placeholder="member@email.com" type="email" />
      </div>

      <div className={"w-4/12"}>
        <MembershipRoleSelector value={member.role} />
      </div>

      <div className={"w-1/12"}>
        <Button
          size={"small"}
          variant={"ghost"}
          onClick={() => memberRemoved(member)}
        >
          <MinusIcon className={"h-5"} />
        </Button>
      </div>
    </div>
  );
};

export default MemberRow;
