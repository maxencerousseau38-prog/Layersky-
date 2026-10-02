import 'server-only';
import { listCliTokens, tokenState } from '@/lib/cli-tokens/data';
import { installBlockers } from '@/lib/github/install';
import { createClient } from '@/lib/supabase/server';
import { type Onboarding, buildOnboarding } from './steps';

/**
 * The guided path for one workspace, read under RLS.
 *
 * Four reads against tables that already exist, in parallel, the same shape as
 * `lib/metrics/load.ts` — and for the same reason: there is no onboarding table
 * and there is not going to be one. Progress is a *view* of the rows the
 * product already writes, so it cannot drift from them. A stored
 * `completed_steps` column would be a second account of the same facts, and the
 * first symptom of the two disagreeing would be a checklist telling somebody to
 * connect a repository they connected an hour ago.
 *
 * `installBlockers()` is the one input that is not a row. It reads this
 * deployment's environment, and it belongs here because "you cannot connect
 * GitHub" and "you have not connected GitHub yet" are different sentences with
 * different readers — one is addressed to an operator, the other to a customer.
 */
export async function loadOnboarding(
  orgSlug: string,
  organizationId: string,
  workspaceName: string,
): Promise<Onboarding> {
  const supabase = await createClient();

  const [installation, projects, runs, tokens, checks] = await Promise.all([
    supabase
      .from('organization_github_installations')
      .select('account_login')
      .eq('organization_id', organizationId)
      .maybeSingle(),
    supabase
      .from('projects')
      .select(
        'slug,name,repository_owner,repository_name,repository_branch,target_locales',
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true }),
    supabase
      .from('runs')
      .select('status,pr_url')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: true })
      .limit(500),
    listCliTokens(organizationId),
    /*
     * A count, by `head: true`, because the page needs "has one ever arrived"
     * and nothing else. Fetching the rows to call `.length` on them would read
     * a workspace's whole check history to answer a yes-or-no question.
     */
    supabase
      .from('i18n_checks')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId),
  ]);

  return buildOnboarding({
    orgSlug,
    workspaceName,
    githubAccountLogin: installation.data?.account_login ?? null,
    githubBlockers: installBlockers(),
    healthChecks: checks.count ?? 0,
    projects: (projects.data ?? []).map((row) => ({
      slug: row.slug,
      name: row.name,
      repositoryOwner: row.repository_owner,
      repositoryName: row.repository_name,
      // The CLI defaults to `main` when no branch is passed; a project that
      // never recorded one would otherwise produce `--base-branch null`.
      baseBranch: row.repository_branch ?? 'main',
      targetLocales: row.target_locales ?? [],
    })),
    activeTokens: tokens.filter((token) => tokenState(token) === 'active')
      .length,
    runs: (runs.data ?? []) as Parameters<typeof buildOnboarding>[0]['runs'],
  });
}
