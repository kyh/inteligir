import { notFound } from 'next/navigation';
import isUserSuperAdmin from '../utils/is-user-super-admin';

type LayoutOrPageComponent<Params> = React.ComponentType<Params>;

const AdminGuard = <Params extends object>(Component: LayoutOrPageComponent<Params>) => async (params: Params) => {
    const isAdmin = await isUserSuperAdmin();

    // if the user is not a super-admin, we redirect to a 404
    if (!isAdmin) {
      notFound();
    }

    return <Component {...params} />;
  };

export default AdminGuard;
