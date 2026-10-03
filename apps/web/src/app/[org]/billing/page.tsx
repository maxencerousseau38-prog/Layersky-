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
              <span className="text-small text-secondary">
                Unlimited. No language, string or seat cap.
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
          <Badge tone="neutral">In development</Badge>
        </div>
        <p className="mt-3 max-w-[68ch] text-small leading-6 text-secondary">
          There is no billing system connected, no card is stored, and nothing
          has been charged. Pricing is not modelled yet, and quoting a number we
          might have to raise is the behaviour this product exists to be an
          alternative to.
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
