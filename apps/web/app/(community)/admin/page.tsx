import { AdminWorkspace } from '@/components/admin-workspace';

export const metadata = { title: 'Admin' };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <main>
      <AdminWorkspace requestedTab={tab} />
    </main>
  );
}
