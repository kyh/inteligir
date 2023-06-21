import MinusIcon from "@heroicons/react/24/outline/MinusIcon";
import type MembershipRole from "~/lib/organizations/types/membership-role";
import { Button } from "~/components/Button";
import { TextField } from "~/components/TextField";
import MembershipRoleSelector from "./MembershipRoleSelector";

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
      key={member.email}
      className="flex items-center justify-between space-x-1"
    >
      <div className="w-7/12">
        <TextField.Input placeholder="member@email.com" type="email" />
      </div>
      <div className="w-4/12">
        <MembershipRoleSelector value={member.role} />
      </div>
      <div className="w-1/12">
        <Button color="transparent" onClick={() => memberRemoved(member)}>
          <MinusIcon className="h-5" />
        </Button>
      </div>
    </div>
  );
};

export default MemberRow;
