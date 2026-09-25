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
      <nav className="grid gap-3 sm:grid-cols-2">
        {[
          {
            href: '/review',
            title: 'Rounds',
            text: 'Replay, decisions, strokes gained, scorecard',
          },
          { href: '/review/trends', title: 'Trends', text: 'Rolling SG, course view, WHS ledger' },
          {
            href: '/clubs',
            title: 'Club dispersion',
            text: 'Patterns, ellipses and refits per club',
          },
          { href: '/import', title: 'Simulator import', text: 'GSPro and Square Golf sessions' },
          { href: '/courses', title: 'Courses', text: 'OSM import and course editor' },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="card block p-4 hover:border-accent">
            <span className="font-semibold">{l.title}</span>
            <span className="text-muted block text-sm">{l.text}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
