import MinusIcon from "@heroicons/react/24/outline/minus-icon";
import MembershipRoleSelector from "./membership-role-selector";
import type MembershipRole from "@/lib/organizations/types/membership-role";
import Button from "ui/components/button";
import TextField from "ui/components/text-field";

type Member = {
  email: string;
  role: MembershipRole;
};

const MemberRow: React.FCC<{
  member: Member;
  memberRemoved: (member: Member) => void;
}> = ({ member, memberRemoved }) => {
  return (
    <div
      className="space-between flex items-center space-x-1"
      key={member.email}
    >
      <div className="w-7/12">
        <TextField.Input placeholder="member@email.com" type="email" />
      </div>

      <div className="w-4/12">
        <MembershipRoleSelector value={member.role} />
      </div>

      <div className="w-1/12">
        <Button
          onClick={() => memberRemoved(member)}
          size="small"
          variant="ghost"
        >
          <MinusIcon className="h-5" />
        </Button>
      </div>
    </div>
  );
};

export default MemberRow;
