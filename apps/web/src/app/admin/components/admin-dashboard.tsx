import { Heading } from "@inteligir/ui";

type Data = {
  usersCount: number;
  organizationsCount: number;
  activeSubscriptions: number;
  trialSubscriptions: number;
};

const AdminDashboard = ({
  data,
}: React.PropsWithChildren<{
  data: Data;
}>) => {
  return (
    <div
      className={
        "grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" +
        " xl:grid-cols-4"
      }
    >
      <div>
        <Heading>Users</Heading>
        <div>
          <div className="flex justify-between">
            <div>{data.usersCount}</div>
          </div>
        </div>
      </div>

      <div>
        <Heading>Organizations</Heading>
        <div>
          <div className="flex justify-between">
            <div>{data.organizationsCount}</div>
          </div>
        </div>
      </div>

      <div>
        <Heading>Paying Customers</Heading>
        <div>
          <div className="flex justify-between">
            <div>{data.activeSubscriptions}</div>
          </div>
        </div>
      </div>

      <div>
        <Heading>Trials</Heading>
        <div>
          <div className="flex justify-between">
            <div>{data.trialSubscriptions}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
