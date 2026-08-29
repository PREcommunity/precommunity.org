import { redirect } from 'next/navigation';

export const metadata = { title: 'Your community submissions' };

export default function LegacyCommunitySubmissionsPage() {
  redirect('/community/proposals/mine');
}
