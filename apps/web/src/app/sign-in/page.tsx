'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/primitives/Input';
import { createClient } from '@/lib/supabase/client';

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setStep('code');
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().auth.verifyOtp({
      email,
      token: code,
      type: 'email',
    });
    setBusy(false);
    if (err) setError(err.message);
    else router.replace('/');
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        onSubmit={step === 'email' ? sendCode : verify}
        className="card w-full max-w-sm space-y-4"
      >
        <h1 className="text-2xl font-bold">CaddyMate</h1>
        <p className="text-muted">
          {step === 'email' ? 'Sign in with your email' : `Enter the code sent to ${email}`}
        </p>
        {step === 'email' ? (
          <Input
            key="email"
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        ) : (
          <Input
            key="code"
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
          />
        )}
        {error ? (
          <p className="text-danger text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <button className="btn w-full" disabled={busy} type="submit">
          {step === 'email' ? 'Send code' : 'Sign in'}
        </button>
        {step === 'code' ? (
          <button type="button" className="link text-sm" onClick={() => setStep('email')}>
            Use a different email
          </button>
        ) : null}
      </form>
    </main>
  );
}
