import { LegalList, LegalPage, LegalSection } from '@/components/legal-prose';
import { PageHeader } from '@/components/page-header';
import {
  CONTACT_URL,
  LEGAL_LAST_UPDATED,
  OPERATOR,
  SUPPORT_EMAIL,
} from '@/lib/constants';
import { StateRule } from '@localize-infra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  alternates: { canonical: '/privacy' },
  title: 'Privacy',
  description:
    'What personal data Layersky holds, where it is stored, who else processes it, where to send a request, and what is still missing.',
};

/**
 * The privacy policy, and deliberately the shortest one this product can
 * honestly write.
 *
 * `/security` already answers "what does this send, and to whom?" in detail
 * and is the page a reviewer reads. This one answers the narrower legal
 * question — what *personal* data exists, on what basis, and what you can ask
 * for — and points at that page rather than restating it badly. Two documents
 * describing one set of facts is how one of them goes stale.
 *
 * **This page used to name two gaps**: no private contact channel for a data
 * request, and no data processing agreement. The second is closed — /dpa sets
 * out the processing this page summarises, offered as it stands rather than
 * "available on request", which is the promise the earlier version refused to
 * make. The first closes with `SUPPORT_EMAIL`, and both of its branches are
 * rendered here rather than one being written and never seen.
 */
export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Privacy"
        lede="Layersky holds very little about you, and most of what it touches is your source code rather than your person. This page covers both, and says where a request goes."
      />

      <LegalPage updated={LEGAL_LAST_UPDATED}>
        <LegalSection id="controller" title="Who holds the data">
          <p>
            {OPERATOR}. There is no company and no data protection officer. That
            is a fact about the size of this project, not an opinion about how
            much it matters, and the consequences are spelled out in{' '}
            <Link
              href="#gaps"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              where a request goes
            </Link>
            .
          </p>
        </LegalSection>

        <LegalSection id="what" title="What personal data exists">
          <p>Almost none. Specifically:</p>
          <LegalList
            items={[
              {
                id: 'account',
                body: (
                  <>
                    <strong>Your email address and a password hash</strong>, if
                    you created a workspace. That is the whole account.
                  </>
                ),
              },
              {
                id: 'github-login',
                body: (
                  <>
                    <strong>Your GitHub account login</strong>, recorded on the
                    workspace when you connect the GitHub App, so the product
                    can say who connected it.
                  </>
                ),
              },
              {
                id: 'activity',
                body: (
                  <>
                    <strong>A record of what your workspace did</strong> — runs,
                    checks, findings, which API tokens were used and when. Tied
                    to the workspace rather than to a person, except where a row
                    names who created it.
                  </>
                ),
              },
              {
                id: 'nothing-else',
                body: (
                  <>
                    <strong>Nothing else.</strong> No name, no company, no
                    payment details, no phone number, no profile. There is no
                    billing, so there is nothing to bill.
                  </>
                ),
              },
            ]}
          />
          <p>
            Your <em>code</em> is a separate question and a bigger one.{' '}
            <Link
              href="/security"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Security &amp; data
            </Link>{' '}
            lists exactly which files are read, which fields leave the EU, and
            what is kept afterwards.
          </p>
        </LegalSection>

        <LegalSection id="analytics" title="Tracking">
          <p>
            This marketing site sets no cookies, runs no analytics, and embeds
            nothing from a third party. There is no consent banner because there
            is nothing to consent to.
          </p>
          <p>
            The hosted application sets one session cookie, which is what keeps
            you signed in. It is not used for analytics and there is no
            advertising anywhere in this product.
          </p>
        </LegalSection>

        <LegalSection id="why" title="Why it is held, and on what basis">
          <LegalList
            items={[
              {
                id: 'contract',
                body: (
                  <>
                    <strong>To run the service you asked for</strong> —
                    performance of a contract. Your email identifies your
                    workspace; the run records are what the product shows you.
                  </>
                ),
              },
              {
                id: 'abuse',
                body: (
                  <>
                    <strong>
                      To stop one workspace exhausting the shared model budget
                    </strong>{' '}
                    — legitimate interest. The daily counters exist for that and
                    for nothing else; they are not a meter and nothing is
                    charged.
                  </>
                ),
              },
            ]}
          />
          <p>
            Nothing here is used to train a model by us. Source strings go to
            Anthropic’s API, and Anthropic states that it does not train on API
            inputs — that is their commitment rather than ours, and it is stated
            as theirs for that reason.
          </p>
        </LegalSection>

        <LegalSection
          id="where"
          title="Where it lives, and who else touches it"
        >
          <p>
            Account data and run records are in a Postgres database hosted by
            Supabase in <strong>Paris (eu-west-3)</strong>. The application and
            API run on Vercel functions in <strong>Paris (cdg1)</strong>.
          </p>
          <p>
            Source strings and the code around them are sent to a model provider
            in the <strong>United States</strong> to be translated. This is a
            stated gap against our own data-residency goal, not an oversight,
            and{' '}
            <Link
              href="/security#residency"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              /security says so in its own words
            </Link>
            .
          </p>
          <p>
            The full sub-processor list — who they are, what they receive and
            which region they are in — is{' '}
            <Link
              href="/security#subprocessors"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              on /security
            </Link>
            , maintained in one place so the two pages cannot disagree.
          </p>
        </LegalSection>

        <LegalSection id="retention" title="How long it is kept">
          <p>
            Account and workspace data are kept until you delete them. Deleting
            a project removes its runs, its proposed translations and its
            recorded ambiguities; deleting a workspace removes the lot.
          </p>
          <p>
            Translations that were merged are in your git history, which is
            yours and which nothing here can reach. That is the design: there is
            no export step because there is nothing to export from.
          </p>
        </LegalSection>

        <LegalSection id="rights" title="Your rights">
          <p>
            If the GDPR applies to you, you have the rights it gives you:
            access, correction, deletion, restriction, objection and
            portability. In practice deletion is self-serve — delete the project
            or the workspace — and the rest requires asking.
          </p>
          <p>
            You also have the right to complain to your national supervisory
            authority.
          </p>
        </LegalSection>

        <LegalSection
          id="gaps"
          title="Where to send a request, and what is still missing"
        >
          {/*
           * This section used to be headed "Two gaps, stated plainly" and the
           * second of them — no data processing agreement — is now closed:
           * /dpa exists and describes the processing this page summarises.
           * The first is closed by one constant.
           */}
          {SUPPORT_EMAIL === null ? (
            <StateRule tone="degraded" className="ps-4">
              <p className="text-body font-medium text-primary">
                There is no private channel for a data request.
              </p>
              <p className="mt-2 text-small leading-6 text-secondary">
                The only contact this project has is a public issue tracker, and
                a public issue is the wrong place to put a request that names
                you. Until a private address exists, a right that needs
                confidentiality cannot be exercised properly here. That is a
                reason to weigh before putting this on a repository that
                matters.
              </p>
            </StateRule>
          ) : (
            <p>
              Send a request to{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {SUPPORT_EMAIL}
              </a>
              , not to the public issue tracker. One person reads it, with no
              committed response time beyond the statutory window.
            </p>
          )}
          <p>
            If you are deploying this across a team, the processing is set out
            in full in{' '}
            <Link
              href="/dpa"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              the data processing agreement
            </Link>{' '}
            — sub-processors, the transfer outside the EU, the security measures
            that exist, and the ones that do not. It is offered as it stands
            rather than negotiated, and it says so.
          </p>
        </LegalSection>

        <LegalSection id="contact" title="Contact">
          <p>
            {SUPPORT_EMAIL === null ? (
              <>
                Everything goes through{' '}
                <a
                  href={CONTACT_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  the public issue tracker
                </a>
                , with the caveat above.{' '}
              </>
            ) : (
              <>
                Anything about your personal data goes to{' '}
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  {SUPPORT_EMAIL}
                </a>
                ; bugs and questions about behaviour belong in{' '}
                <a
                  href={CONTACT_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  the public issue tracker
                </a>
                .{' '}
              </>
            )}
            <Link
              href="/contact"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Contact and support
            </Link>
            .
          </p>
        </LegalSection>

        <LegalSection id="changes" title="Changes">
          <p>
            This page lives in a public git repository, so every change has a
            commit, a date and a diff. The date at the top is the last one.
          </p>
        </LegalSection>
      </LegalPage>
    </>
  );
}
