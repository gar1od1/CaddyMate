'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { refitClubs } from '@/lib/sim/functions';

/** Calls the `refit` Edge Function for the given clubs (all when omitted), then reloads. */
export function RefitButton({
  clubIds,
  label = 'Refit now',
}: {
  clubIds?: string[];
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className="btn px-4 py-2"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage(null);
          const r = await refitClubs(createClient(), clubIds);
          setBusy(false);
          if (r.ok) {
            setMessage({ ok: true, text: 'Refit done.' });
            router.refresh();
          } else setMessage({ ok: false, text: r.message });
        }}
      >
        {busy ? 'Refitting…' : label}
      </button>
      {message ? (
        <p className={`max-w-xs text-right text-xs ${message.ok ? 'text-muted' : 'text-danger'}`}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
