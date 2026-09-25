import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SignOutButton } from './sign-out-button';

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, handedness, handicap_index_official')
    .eq('user_id', user.id)
    .maybeSingle();

  return (
    <main className="mx-auto w-full max-w-3xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">CaddyMate</h1>
        <SignOutButton />
      </header>
      <section className="card space-y-1">
        <p className="text-muted text-sm">Signed in as</p>
        <p className="text-lg">{profile?.display_name ?? user.email}</p>
        <p className="text-muted text-sm">
          {profile?.handedness === 'L' ? 'Left-handed' : 'Right-handed'}
          {profile?.handicap_index_official != null
            ? ` · HI ${profile.handicap_index_official}`
            : ''}
        </p>
      </section>
      <section className="card">
        <h2 className="font-semibold">Coming next</h2>
        <ul className="text-muted mt-2 list-disc pl-5 text-sm">
          <li>Simulator import (GSPro / Square) — Phase A</li>
          <li>
            <Link href="/courses" className="link">
              Course editor
            </Link>{' '}
            — Phase 1
          </li>
          <li>Round review — Phase C</li>
        </ul>
      </section>
    </main>
  );
}
