import { Page, PageHeader, PageMeta } from '@/components/page';
import {
  findEntitlements,
  findOrganization,
  requireSession,
} from '@/lib/data/workspace';
import { Badge } from '@localize-infra/ui';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const metadata: Metadata = { title: 'Billing' };

/**
 * Billing, which currently bills nothing.
 *
 * The marketing site says, in public: "There is no billing system, and nothing
 * is charged today", and "Public repositories: Free. Unlimited, permanently."
 * This page has to agree with both — a workspace surface implying a card on
 * file, a trial clock or a usage bar would make /pricing a lie, and the whole
 * argument that page makes is that this product does not do that.
 *
 * So there is no invoice list, no payment method, no usage meter. There is what
 * the workspace can do today, and an honest account of what is not built.
 */
export default async function BillingPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  await requireSession();
  const { org } = await params;

  const organization = await findOrganization(org);
  if (!organization) notFound();

  const entitlements = await findEntitlements(organization.id);

  return (
    <Page>
      <PageHeader
        title="Billing"
        purpose="What this workspace can do, and what it costs — which today is nothing."
        meta={
          <>
            <PageMeta label="Plan">{entitlements.plan}</PageMeta>
            <PageMeta label="Charged">Nothing</PageMeta>
          </>
        }
      />

      <section
        aria-labelledby="included"
        className="mt-6 rounded-lg border border-line bg-surface/40 px-5 py-6"
      >
        <h2 id="included" className="text-subtitle font-semibold text-primary">
          What this workspace can do
        </h2>

        <dl className="mt-4 grid gap-px overflow-hidden rounded-lg border border-subtle bg-subtle sm:grid-cols-2">
          <div className="bg-canvas px-4 py-3">
            <dt className="text-eyebrow font-medium uppercase text-tertiary">
              Public repositories
            </dt>
            <dd className="mt-1 flex items-baseline gap-2">
              <Badge tone="confident">Included</Badge>
              {/*
                **"No string cap" was fixed on /pricing and not here.** The
                hosted API grew a daily ceiling (`api_limits()`), so this said
                the opposite of what the API enforces — the same cross-surface
                miss CLAUDE.md records twice already: a correction on one
                surface says nothing about another that repeats the claim.
                The numbers are deliberately not duplicated here; Usage reads
                them from `api_limits()` rather than from a second constant that
                could drift.
              */}
              <span className="text-small text-secondary">
                Unlimited projects and languages. No seat cap. A daily ceiling
                does apply to the hosted API, to stop runaway scripts rather
                than to charge you — Usage shows it against today&rsquo;s spend.
              </span>
            </dd>
          </div>

          <div className="bg-canvas px-4 py-3">
            <dt className="text-eyebrow font-medium uppercase text-tertiary">
              Private repositories
            </dt>
            <dd className="mt-1 flex items-baseline gap-2">
              {entitlements.private_repositories ? (
                <>
                  <Badge tone="confident">Included</Badge>
                  <span className="text-small text-secondary">
                    Granted on this workspace.
                  </span>
                </>
              ) : (
                <>
                  <Badge tone="neutral">Not included</Badge>
                  {/*
                   * This said "Needs a paid plan", which stopped being true
                   * when `link_github_installation` started granting the
                   * entitlement in the same transaction as the link. It was
                   * pointing a reader at a plan nobody can buy, on the page
                   * that also says no plan is priced — the two halves of one
                   * screen disagreeing.
                   */}
                  <span className="text-small text-secondary">
                    Granted when this workspace connects GitHub.
                  </span>
                </>
              )}
            </dd>
          </div>
        </dl>
      </section>

      {/*
       * The same words the marketing site uses, because a customer reading both
       * must not find two different stories. Publishing a price here that
       * /pricing refuses to publish would be the more damaging half of that
       * contradiction.
       */}
      <section
        aria-labelledby="paid"
        className="mt-6 rounded-lg border border-line bg-surface/40 px-5 py-6"
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="paid" className="text-subtitle font-semibold text-primary">
            Paid plans are not priced yet
          </h2>
          {/*
            `/pricing` says "Not started" because there is no Stripe anywhere
            in the repository. This said "In development", two surfaces
            disagreeing about the same thing — and "in development" tells a
            reader work is under way when no commit backs it.
          */}
          <Badge tone="neutral">Not started</Badge>
        </div>
        <p className="mt-3 max-w-[68ch] text-small leading-6 text-secondary">
          There is no billing system connected, no card is stored, and nothing
          has been charged. What the service costs to run is modelled, and one
          production run has been measured — but those figures are consumption
          priced at the provider&rsquo;s published rate, not reconciled against
          a supplier invoice. The commercial numbers are not decided, and no
          customer has agreed to pay one, so quoting a figure here would be
          inventing the part that is actually missing.
        </p>
        <p className="mt-3 max-w-[68ch] text-small leading-6 text-secondary">
          The commitment is firm regardless of where the numbers land: flat, per
          project and active language, never metered by words, characters, keys
          or seats.
        </p>
      </section>
    </Page>
  );
}
