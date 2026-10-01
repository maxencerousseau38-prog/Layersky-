import { isSupabaseConfigured } from '@/lib/supabase/env';
import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

/**
 * The only unauthenticated surface in the application.
 *
 * It renders outside the app shell on purpose: a sidebar of destinations you
 * cannot reach is noise, and the topbar's workspace controls have nothing to
 * point at yet.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const configured = isSupabaseConfigured();

  const linkError =
    error === 'expired-link'
      ? 'That confirmation link has expired or was already used. Sign in, or sign up again to get a new one.'
      : error === 'missing-code'
        ? 'That link was incomplete. Open the most recent confirmation email and try again.'
        : undefined;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-16">
      <h1 className="font-display text-display font-semibold text-primary">
        Sign in
      </h1>
      <p className="mt-2 text-body text-secondary">
        Layersky keeps your translations in your repository. An account records
        which repositories you have connected — never the strings themselves.
      </p>

      {configured ? (
        <LoginForm next={next} linkError={linkError} />
      ) : (
        /*
         * Honest degradation rather than a crash. A checkout without
         * SUPABASE_URL still builds and still renders this page; it says what
         * is missing instead of throwing on import.
         */
        <p className="mt-8 rounded-lg border border-line bg-surface p-4 text-small leading-6 text-secondary">
          This deployment has no database configured, so accounts are
          unavailable. Set <code className="font-mono">SUPABASE_URL</code> and{' '}
          <code className="font-mono">SUPABASE_PUBLISHABLE_KEY</code> to enable
          sign-in.
        </p>
      )}
    </main>
  );
}
