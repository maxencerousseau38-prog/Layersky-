import { checkState } from '@/components/health-table';
import { Metric, MetricGrid } from '@/components/metric';
import { Page, PageHeader, PageSection } from '@/components/page';
import { findOrganization, requireSession } from '@/lib/data/workspace';
import { findCheck, listFindings } from '@/lib/i18n/health';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import {
  Alert,
  Badge,
  EmptyState,
  StatusDot,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '@localize-infra/ui';
import { ExternalLink, GitPullRequest } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Check' };

/**
 * One check, and every problem it found.
 *
 * ## The two columns that carry the product
 *
 * **What is wrong**, in the audit's own sentence — not a paraphrase. And
 * **whether Layersky may fix it**, with the reason when it may not. The second
 * is the whole thesis: this is not a translator, it is a guardrail that knows
 * the difference between a gap it can close and a judgement it must not make.
 *
 * Both are stored, not derived here. `planCorrection` decided correctability at
 * the moment the check ran, and re-deciding it in this component would be a
 * second rule free to disagree — the duplicate-tally defect this repository has
 * paid for more than once.
 *
 * ## Colour
 *
 * DESIGN.md §6.3. A finding Layersky will fix is `confident` because the fix is
 * real and present. One it refuses is **not** `ambiguous`: Iris is reserved for
 * "your judgement is required" (§1.4), and that is exactly what a refusal
 * means, so it is the one place on this page that earns it.
 */
const KIND: Record<string, { label: string; what: string }> = {
  'missing-translation': {
    label: 'Missing translation',
    what: 'The source locale defines this key and this language does not. At runtime the reader sees the source text, or the key itself.',
  },
  'missing-source': {
    label: 'Missing source',
    what: 'The code calls a key the source locale does not define. Every language is missing it, and there is nothing to translate from.',
  },
  'placeholder-mismatch': {
    label: 'Placeholder mismatch',
    what: 'This translation does not carry the same placeholders as its source. At runtime it renders the literal token or throws.',
  },
  'icu-invalid': {
    label: 'Invalid ICU',
    what: 'This translation is not a valid ICU message, so the formatter cannot render it.',
  },
};

export default async function CheckDetailPage({
  params,
}: {
  params: Promise<{ org: string; check: string }>;
}) {
  const { org, check: checkId } = await params;

  if (!isSupabaseConfigured()) notFound();

  await requireSession();
  const organization = await findOrganization(org);
  if (!organization) notFound();

  const check = await findCheck(checkId);
  // RLS already hides another workspace's check; this also catches a check id
  // that belongs to a workspace the reader *is* in but is not the one in the
  // URL, which would otherwise render under the wrong breadcrumb.
  if (!check || check.organizationId !== organization.id) notFound();

  const findings = await listFindings(check.id);
  const repository = `${check.repositoryOwner}/${check.repositoryName}`;
  const state = checkState({
    skipped: check.skippedReason !== null,
    findingCount: findings.length,
  });

  return (
    <Page>
      <PageHeader
        title={`${repository} #${check.pullNumber}`}
        purpose={check.summary.split('\n')[0] ?? ''}
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusDot tone={state.tone}>{state.label}</StatusDot>
        <span className="font-mono text-caption text-tertiary">
          {check.headSha.slice(0, 7)}
        </span>
        {/* The artefacts. A summary that cannot be traced to the thing it
            summarises is not evidence, so both links are at the top. */}
        {check.checkRunUrl ? (
          <ExternalAction href={check.checkRunUrl} icon="check">
            GitHub check
          </ExternalAction>
        ) : null}
        {check.correctivePrUrl && check.correctivePrNumber ? (
          <ExternalAction href={check.correctivePrUrl} icon="pr">
            Corrective pull request #{check.correctivePrNumber}
          </ExternalAction>
        ) : null}
      </div>

      {check.skippedReason ? (
        /* Not amber. Nothing was read, so there is no behaviour to report as
           degraded — DESIGN.md §6.3. */
        <Alert tone="neutral" heading="Not analysed">
          {check.skippedReason}
        </Alert>
      ) : null}

      {check.correctionRequested !== null ? (
        <PageSection
          title="Automatic correction"
          description="What Layersky wrote, and what it left for a person."
        >
          {/*
           * `Metric`, not a bespoke tile. DESIGN.md §8: one object, one
           * geometry — a count here and a count on `/[org]/usage` are the
           * same object, and the first version of this page invented a
           * second shape for it (and reached for an editorial type step
           * doing so, which `type-scale.test.ts` caught).
           */}
          <MetricGrid label="What the correction did" columns={3}>
            <Metric
              label="Asked for"
              value={String(check.correctionRequested)}
            />
            <Metric
              label="Written"
              value={String(check.correctionApplied ?? 0)}
            />
            <Metric
              label="Left for a person"
              value={String(check.correctionRefused ?? 0)}
            />
          </MetricGrid>
          {check.correctionNote ? (
            <p className="text-body text-secondary">{check.correctionNote}</p>
          ) : null}
        </PageSection>
      ) : null}

      <PageSection
        title="Problems"
        description="Each one as the audit reported it, and whether Layersky may fix it."
      >
        {findings.length === 0 ? (
          <EmptyState
            title={
              check.skippedReason
                ? 'Nothing was checked'
                : 'No problems on this commit'
            }
            description={
              check.skippedReason
                ? 'Layersky could not read this repository, so it found nothing. That is not the same as nothing being wrong.'
                : 'Every key this pull request touches is present in every language it ships, with matching placeholders.'
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH className="w-[11rem]">Problem</TH>
                <TH>Key</TH>
                <TH className="hidden sm:table-cell w-[5rem]">Language</TH>
                <TH>What it means</TH>
                <TH className="w-[13rem]">Layersky</TH>
              </TR>
            </THead>
            <TBody>
              {findings.map((finding) => {
                const kind = KIND[finding.kind];
                return (
                  <TR key={finding.id}>
                    <TD>
                      <Badge
                        tone={finding.correctable ? 'degraded' : 'ambiguous'}
                      >
                        {kind?.label ?? finding.kind}
                      </Badge>
                    </TD>
                    <TD>
                      <span className="font-mono text-caption text-primary break-all">
                        {finding.key}
                      </span>
                      <span className="ms-2 font-mono text-caption text-tertiary sm:hidden">
                        {finding.locale ?? ''}
                      </span>
                    </TD>
                    <TD className="hidden sm:table-cell font-mono text-caption text-secondary">
                      {finding.locale ?? '—'}
                    </TD>
                    <TD className="text-secondary">
                      {/* The audit's own sentence first — it names the key and
                          the placeholder. The generic explanation second, for
                          a reader meeting this kind for the first time. */}
                      <p>{finding.detail}</p>
                      {kind ? (
                        <p className="mt-1 text-caption text-tertiary">
                          {kind.what}
                        </p>
                      ) : null}
                    </TD>
                    <TD>
                      {finding.correctable ? (
                        <>
                          <StatusDot tone="confident">Will fix</StatusDot>
                          <p className="mt-1 text-caption text-tertiary">
                            Translated from the source and re-checked before it
                            is committed.
                          </p>
                        </>
                      ) : (
                        <>
                          {/* Iris, and only here. §1.4 reserves it for "your
                              judgement is required", which is precisely what a
                              refusal to correct means. */}
                          <StatusDot tone="ambiguous">Your call</StatusDot>
                          {finding.refusalReason ? (
                            <p className="mt-1 text-caption text-tertiary">
                              {finding.refusalReason}
                            </p>
                          ) : null}
                        </>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </PageSection>
    </Page>
  );
}

function ExternalAction({
  href,
  icon,
  children,
}: {
  href: string;
  icon: 'check' | 'pr';
  children: React.ReactNode;
}) {
  const Icon = icon === 'pr' ? GitPullRequest : ExternalLink;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 rounded-sm text-body text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {children}
    </a>
  );
}
