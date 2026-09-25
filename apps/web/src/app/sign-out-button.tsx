'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="link text-sm"
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace('/sign-in');
      }}
    >
      Sign out
    </button>
  );
}
