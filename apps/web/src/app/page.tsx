import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card } from '@/components/primitives/Card';
import { Page, PageHeader } from '@/components/primitives/Page';
import { createClient } from '@/lib/supabase/server';

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
    <Page width="narrow">
      <PageHeader title="Dashboard" />
      <Card className="gap-1">
        <p className="text-muted text-sm">Signed in as</p>
        <p className="text-lg">{profile?.display_name ?? user.email}</p>
        <p className="text-muted text-sm">
          {profile?.handedness === 'L' ? 'Left-handed' : 'Right-handed'}
          {profile?.handicap_index_official != null
            ? ` · HI ${profile.handicap_index_official}`
            : ''}
        </p>
      </Card>
      <div className="grid-2">
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
      </div>
    </Page>
  );
}
