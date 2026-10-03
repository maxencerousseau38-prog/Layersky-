import { LegalList, LegalPage, LegalSection } from '@/components/legal-prose';
import { PageHeader } from '@/components/page-header';
import {
  CONTACT_URL,
  HOSTED_API_LIMITS,
  LEGAL_LAST_UPDATED,
  OPERATOR,
} from '@/lib/constants';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  alternates: { canonical: '/terms' },
  title: 'Terms',
  description:
    'What Layersky is today, what it writes to your repository, what it costs, and the warranties nobody is giving you.',
};

/**
 * Terms, written to the same rule as the rest of this site: every sentence
 * must be true today.
 *
 * That rules out most of what a terms page usually contains. There is no
 * company, no contract, no payment, no SLA and no support commitment, so this
 * says so rather than borrowing the paragraph a SaaS template would supply.
 * A terms page that promises an uptime nobody measures is worse than none,
 * because it is the first document a customer will hold you to.
 *
 * The numbers here are read from `HOSTED_API_LIMITS`, which /pricing and /docs
 * also read, so the ceiling cannot be stated three ways.
 */
export default function TermsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Terms of use"
        lede="Layersky is early-access software with no price and no contract. This page says what that actually means before you install it on a repository."
      />

      <LegalPage updated={LEGAL_LAST_UPDATED}>
        <LegalSection id="who" title="Who you are agreeing with">
          <p>
            {OPERATOR}. There is no company behind this and no incorporated
            entity to name; it is an individual’s project, and saying otherwise
            would be the first thing on this site that is not true.
          </p>
          <p>
            By creating a workspace or installing the GitHub App, you accept
            these terms. If you do not, do not install it — nothing here reads a
            repository you have not explicitly selected.
          </p>
        </LegalSection>

        <LegalSection id="service" title="What the service does">
          <p>
            Layersky reads the i18n catalogues in a pull request, posts the
            problems it finds as a GitHub check on the commit, and opens a
            second pull request containing the translations it judged safe to
            write. It also ships a command-line tool that extracts hardcoded
            strings from source and translates them.
          </p>
          <p>
            The check is <strong>never blocking</strong>: it reports a neutral
            conclusion whatever it finds, so it cannot prevent a merge. That is
            a property of the product today and not a promise about tomorrow; if
            it ever becomes capable of failing a check, it will be because
            somebody asked for it, and it will be announced before it is
            shipped.
          </p>
        </LegalSection>

        <LegalSection id="writes" title="What it writes to your repository">
          <p>
            Layersky only ever adds a branch and opens a pull request. It does
            not push to a protected branch, it does not merge anything, and it
            does not delete. Writes are additionally constrained server-side to{' '}
            <code className="font-mono text-small">.json</code> files under your
            locales directory; a request naming any other path is rejected
            before it reaches GitHub.
          </p>
          <p>
            It reaches only the repositories you selected when installing the
            GitHub App. Changing that selection on GitHub changes what it can
            read, immediately and without anything happening here.
          </p>
          <p>
            <strong>You review and merge everything.</strong> Nothing Layersky
            produces reaches your default branch without a human approving it.
            That is the whole safety model, and it is why the paragraph below
            can be as blunt as it is.
          </p>
        </LegalSection>

        <LegalSection id="price" title="Price">
          <p>
            Nothing is charged. There is no billing integration in the product,
            no card is collected, and no plan can be bought. When there is a
            price it will be a flat subscription — never metered by word,
            character, key, translation or seat — and it will be announced
            before it applies to anybody.
          </p>
          <p>
            Fair-use ceilings exist so that one workspace cannot exhaust the
            shared model budget:{' '}
            {HOSTED_API_LIMITS.stringsPerDay.toLocaleString('en-GB')}{' '}
            string-language pairs and {HOSTED_API_LIMITS.pullRequestsPerDay}{' '}
            pull requests per workspace per day, resetting at 00:00 UTC. They
            are abuse limits and not a meter; nothing is charged for crossing
            them, you are simply refused until the reset.{' '}
            <Link
              href="/pricing"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              More on pricing
            </Link>
            .
          </p>
        </LegalSection>

        <LegalSection id="ai" title="Machine translation, and what that means">
          <p>
            Translations are produced by a large language model. They are
            proposals in a pull request, not finished localisation, and nobody
            has reviewed them for your product’s voice, your legal copy or your
            market. A translation the model was not confident about is not
            written at all — the question is reported instead — but a confident
            translation can still be wrong.
          </p>
          <p>
            Source strings and a short amount of surrounding code are sent to
            model providers outside the EU.{' '}
            <Link
              href="/security"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Security &amp; data
            </Link>{' '}
            lists exactly what is sent, to whom, and where our data-residency
            commitment currently falls short.
          </p>
        </LegalSection>

        <LegalSection id="acceptable" title="What you may not do">
          <LegalList
            items={[
              {
                id: 'unauthorised',
                body: 'Install it on a repository you are not authorised to modify.',
              },
              {
                id: 'ceilings',
                body: 'Work around the fair-use ceilings, for instance by spreading one project across several workspaces.',
              },
              {
                id: 'unlawful',
                body: 'Use it to generate content that is unlawful where you are.',
              },
              {
                id: 'resell',
                body: 'Resell access to the hosted service. The open-source packages are a different matter — see the licence.',
              },
            ]}
          />
          <p>
            Accounts that do any of this can be suspended without notice.
            Because nothing is paid for, there is nothing to refund.
          </p>
        </LegalSection>

        <LegalSection
          id="availability"
          title="Availability, and the absence of any promise about it"
        >
          <p>
            There is no service level. The hosted service can be unavailable,
            slow, or withdrawn, at any time and without notice. No uptime is
            measured, so none is published.
          </p>
          <p>
            <strong>
              This is the reason the product is built the way it is.
            </strong>{' '}
            Translations are committed to your repository as ordinary JSON. If
            Layersky disappeared tomorrow, everything it ever produced for you
            is already in your git history and needs no export step.
          </p>
        </LegalSection>

        <LegalSection
          id="warranty"
          title="No warranty, and the limit of liability"
        >
          <p>
            The service is provided “as is”, without warranty of any kind,
            express or implied, including merchantability, fitness for a
            particular purpose and non-infringement.
          </p>
          <p>
            To the maximum extent the law allows, the operator is not liable for
            any indirect, incidental or consequential damage, nor for lost
            profit, revenue or data, arising from your use of the service.
            Nothing in these terms excludes liability that cannot lawfully be
            excluded — including for death, personal injury, or fraud.
          </p>
          <p>
            Consumer protections that apply to you where you live apply
            regardless of this page.
          </p>
        </LegalSection>

        <LegalSection id="termination" title="Ending it">
          <p>
            Uninstall the GitHub App and Layersky immediately loses all access
            to your code; the product is told by GitHub and forgets the
            installation. Deleting your workspace removes its projects, runs and
            stored proposals.
          </p>
          <p>
            What stays is everything that was merged, because it is in your
            repository and was always yours.
          </p>
        </LegalSection>

        <LegalSection id="changes" title="Changes to these terms">
          <p>
            This page is in a public git repository, so every change to it has a
            commit, a date and a diff. The date at the top is the last one.
            Material changes will be noted here rather than announced privately.
          </p>
        </LegalSection>

        <LegalSection id="contact" title="Contact">
          <p>
            Questions about these terms go to{' '}
            <a
              href={CONTACT_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              the public issue tracker
            </a>
            , which is the only channel that exists.{' '}
            <Link
              href="/contact"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              What that means in practice
            </Link>
            .
          </p>
        </LegalSection>
      </LegalPage>
    </>
  );
}
