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
  alternates: { canonical: '/dpa' },
  title: 'Data processing agreement',
  description:
    'The processing Layersky performs on your behalf, the sub-processors involved, the transfers outside the EU, the security measures that actually exist, and what is not offered.',
};

/**
 * The data processing agreement.
 *
 * /privacy named its absence as one of two gaps before a first external team:
 * "claiming one is available on request when nothing has been drafted would
 * be the kind of promise this site exists not to make". This is that draft,
 * and the rule it is written to is the same as every other page here — every
 * clause describes processing that actually happens, and anything not offered
 * is named as not offered rather than left out.
 *
 * Each section below was written from the code rather than from a template:
 * the sub-processors come from the same facts /security publishes, the
 * security measures are ones that can be pointed at in this repository, and
 * the retention clause describes what deleting a project actually does.
 *
 * **What this is not.** It is not negotiated, not signed, and not reviewed by
 * a lawyer. It is a controller-to-processor agreement offered on these terms,
 * which is what a project this size can honestly do; a customer who needs a
 * negotiated DPA with warranties and an indemnity needs a supplier with a
 * legal entity, and that is said in as many words below.
 */

/** Exactly what /security publishes, because two lists would diverge. */
const SUBPROCESSORS = [
  {
    name: 'Supabase',
    role: 'Database and sign-in for the hosted app',
    region: 'EU — Paris (eu-west-3)',
  },
  {
    name: 'Vercel',
    role: 'Hosting for the site, the app and the API',
    region:
      'EU — Paris (cdg1) for functions; static pages from a global network',
  },
  {
    name: 'Anthropic',
    role: 'Translation model',
    region: 'United States',
  },
  {
    name: 'OpenAI',
    role: 'Translation model, only where the API instance holds an OpenAI key',
    region: 'United States',
  },
  {
    name: 'GitHub',
    role: 'Reading the files of a pull request, posting the check, opening the corrective pull request',
    region: 'United States',
  },
];

export default function DpaPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Data processing agreement"
        lede="What Layersky processes on your behalf, who else touches it, where it goes, and what is deliberately not promised. Offered on these terms rather than negotiated."
      />

      <LegalPage updated={LEGAL_LAST_UPDATED}>
        <LegalSection id="parties" title="The parties, and which is which">
          <p>
            You are the <strong>controller</strong>. {OPERATOR} is the{' '}
            <strong>processor</strong>, acting only on your documented
            instructions — which, in practice, are the actions you take in the
            product: connecting a repository, opening a pull request, merging a
            corrective one.
          </p>
          <p>
            This agreement applies from the moment you create a workspace and
            lasts as long as you have one. It forms part of{' '}
            <Link
              href="/terms"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              the terms
            </Link>
            ; where the two disagree about personal data, this page wins.
          </p>
          {SUPPORT_EMAIL === null ? (
            <StateRule tone="degraded" className="ps-4">
              <p className="text-body font-medium text-primary">
                It cannot be executed yet.
              </p>
              <p className="mt-2 text-small leading-6 text-secondary">
                A data processing agreement needs a private channel to be signed
                through and to carry a breach notice, and there is no support
                address published yet. The terms below are the ones that would
                be offered; until an address exists, treat this as a disclosure
                of how the processing works rather than as an executed
                agreement.
              </p>
            </StateRule>
          ) : (
            <p>
              To execute it, email{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=Data%20processing%20agreement`}
                className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {SUPPORT_EMAIL}
              </a>{' '}
              naming your workspace. A countersigned copy comes back by email;
              there is no portal and no signature service.
            </p>
          )}
        </LegalSection>

        <LegalSection id="scope" title="What is processed, and why">
          <p>
            Narrow, and worth reading rather than skimming, because most of what
            Layersky touches is your source code rather than anybody’s personal
            data.
          </p>
          <p>
            <strong>Subject matter:</strong> checking the i18n catalogues in
            your pull requests, translating the values that are missing, and
            opening a pull request containing them.
          </p>
          <p>
            <strong>Nature and purpose:</strong> reading, storing, machine
            translation, and writing back to your repository through GitHub. No
            profiling, no automated decision-making about a person, no
            advertising, no analytics.
          </p>
          <p>
            <strong>Duration:</strong> for as long as your workspace exists.
          </p>
          <p>
            <strong>Categories of data subject:</strong> the members of your
            workspace; and, incidentally, any person whose details appear in a
            UI string or a locale catalogue in your repository — Layersky cannot
            tell the difference between a greeting and a name.
          </p>
          <p>
            <strong>Categories of personal data:</strong>
          </p>
          <LegalList
            items={[
              {
                id: 'account',
                body: 'Account email address and password hash, for each member who signs up.',
              },
              {
                id: 'github',
                body: 'The GitHub account login of whoever connected the installation.',
              },
              {
                id: 'activity',
                body: 'A record of workspace activity: runs, checks, findings, which API token was used and when.',
              },
              {
                id: 'content',
                body: 'Whatever your repository’s UI strings and locale catalogues happen to contain. This is content you control, not data we collect, and it is the category most likely to be overlooked.',
              },
            ]}
          />
          <p>
            No special-category data is asked for, and the product has no field
            that would hold any.
          </p>
        </LegalSection>

        <LegalSection
          id="instructions"
          title="Acting only on your instructions"
        >
          <p>
            Layersky processes personal data only to provide the service and
            only as the product’s own actions imply. It is not used to train a
            model, not sold, not shared with anyone outside the sub-processors
            below, and not used to build anything about you.
          </p>
          <p>
            It reaches exactly the repositories your GitHub installation
            selects, and nothing else. Narrowing that selection on GitHub
            narrows the processing immediately, without anything happening here.
            That is a stronger control than a clause, because it is enforced by
            GitHub rather than by us.
          </p>
          <p>
            Everyone with access is bound to confidentiality. Today that is one
            person, which is stated rather than dressed up as a policy.
          </p>
        </LegalSection>

        <LegalSection id="subprocessors" title="Sub-processors">
          <p>
            You authorise these, and only these. The same list is published on{' '}
            <Link
              href="/security#subprocessors"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              /security
            </Link>
            , maintained in one place so the two cannot disagree.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-start">
              <thead>
                <tr className="border-b border-line">
                  <th
                    scope="col"
                    className="py-2.5 pe-4 text-start text-caption font-medium uppercase tracking-wide text-tertiary"
                  >
                    Sub-processor
                  </th>
                  <th
                    scope="col"
                    className="py-2.5 pe-4 text-start text-caption font-medium uppercase tracking-wide text-tertiary"
                  >
                    What it does
                  </th>
                  <th
                    scope="col"
                    className="py-2.5 text-start text-caption font-medium uppercase tracking-wide text-tertiary"
                  >
                    Region
                  </th>
                </tr>
              </thead>
              <tbody>
                {SUBPROCESSORS.map((sub) => (
                  <tr key={sub.name} className="border-b border-subtle">
                    <td className="py-3 pe-4 align-top text-small leading-6 text-primary">
                      {sub.name}
                    </td>
                    <td className="py-3 pe-4 align-top text-small leading-6 text-secondary">
                      {sub.role}
                    </td>
                    <td className="py-3 align-top text-small leading-6 text-secondary">
                      {sub.region}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <strong>Changes get 30 days’ notice</strong>, posted on /security
            before the sub-processor is used. That is a commitment this project
            can actually keep and you can actually audit: the page is in a
            public git repository, so the commit that adds a name carries its
            own date, and you do not have to take our word for when it changed.
            If you object within those 30 days and we cannot accommodate you,
            you may stop using the service — there is nothing to refund, because
            nothing is charged.
          </p>
        </LegalSection>

        <LegalSection id="transfers" title="Transfers outside the EU">
          <p>
            Your account data and run records stay in Paris. Three things leave:
            the source strings and surrounding code sent to a translation model
            in the United States, and the locale files written back through
            GitHub.
          </p>
          <p>
            <strong>This is a real gap and it is ours, not a formality.</strong>{' '}
            EU data residency is one of this project’s own stated invariants and
            the translation leg breaks it;{' '}
            <Link
              href="/security#residency"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              /security says so in its own words
            </Link>
            . Each transfer relies on the receiving sub-processor’s own transfer
            mechanism under its terms with us. No standard contractual clauses
            have been separately executed between you and us for these
            transfers, and no transfer impact assessment has been carried out.
            If that matters to your organisation, it matters now rather than
            after the first pull request.
          </p>
        </LegalSection>

        <LegalSection id="security" title="Security measures">
          <p>
            Technical measures that exist and can be pointed at in the public
            repository, rather than a list of intentions:
          </p>
          <LegalList
            items={[
              {
                id: 'rls',
                body: 'Every tenant-scoped table is behind Postgres row-level security, so one workspace reading another returns nothing rather than being refused by application code.',
              },
              {
                id: 'tokens',
                body: 'CLI tokens are stored only as a SHA-256 hash, in a column the signed-in role cannot read. They expire and can be revoked individually.',
              },
              {
                id: 'paths',
                body: 'Writes to your repository are constrained server-side to .json files whose first path segment is locales. Anything else is rejected before it reaches GitHub.',
              },
              {
                id: 'secrets',
                body: 'The database service-role key is held server-side only and never reaches a browser. Provider errors are logged and not returned, because a rejected API key error quotes part of the key.',
              },
              {
                id: 'transport',
                body: 'HTTPS everywhere, and a per-request nonce content security policy on the application.',
              },
              {
                id: 'passwords',
                body: 'Passwords are at least 12 characters, rejected if they contain the email address, and hashed by the authentication provider.',
              },
            ]}
          />
          <StateRule tone="degraded" className="ps-4">
            <p className="text-body font-medium text-primary">
              And what is not there.
            </p>
            <p className="mt-2 text-small leading-6 text-secondary">
              No SOC 2, no ISO 27001, no penetration test, no data protection
              officer, no security team. Checking passwords against a breach
              corpus is a paid feature of our database provider and the plan is
              the free one, so it is <em>unavailable</em> rather than
              unconfigured. None of this is coming before there are customers to
              justify it, and pretending otherwise is the one failure a security
              page cannot recover from.
            </p>
          </StateRule>
        </LegalSection>

        <LegalSection id="breach" title="If there is a breach">
          <p>
            You are told without undue delay once we become aware, with what is
            known at the time: what happened, which data and roughly how many
            people are affected, the likely consequences, and what is being
            done. If the picture is incomplete it is sent incomplete and
            updated, rather than held back until it is tidy.
          </p>
          {SUPPORT_EMAIL === null ? (
            <p>
              <strong>
                This clause does not work while there is no private channel.
              </strong>{' '}
              A breach notice cannot be a public issue. It is the clearest
              reason the address above is a blocker rather than a polish item.
            </p>
          ) : (
            <p>
              Notice goes to the email address on your workspace account, from{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {SUPPORT_EMAIL}
              </a>
              .
            </p>
          )}
        </LegalSection>

        <LegalSection
          id="assistance"
          title="Helping you meet your own obligations"
        >
          {/*
           * **This section said a workspace deletion needs no request, and
           * "Return and deletion" below says it is done by hand.** One
           * document, two answers, and this was the one that overstated the
           * product: no `deleteWorkspace`, `deleteOrganization` or
           * `deleteAccount` exists anywhere in the repository. An account is
           * additionally blocked while it owns a workspace, because
           * `organizations.created_by` is `on delete restrict`.
           *
           * #148 corrected the clause below and left this one standing — the
           * same cross-surface miss CLAUDE.md records for the `export` command
           * and for the GitHub App permissions. A fix on one surface says
           * nothing about another that repeats the claim.
           *
           * The request route is not given a new timescale or an owner here:
           * the paragraph that follows already states what is promised for
           * anything the product cannot do, and this one defers to it rather
           * than competing with it.
           */}
          <p>
            Some of what a data subject can ask for, you can do yourself and
            immediately: deleting a project removes its runs, the strings they
            extracted and the translations they proposed. Nothing has to be
            requested for that.
          </p>
          <p>
            Deleting a whole workspace, or an account, has to be asked for —
            there is no self-serve surface for either. What that removes is
            described under “Return and deletion” below.
          </p>
          <p>
            For anything the product cannot do — a copy of what is held, a
            correction, a restriction — ask, and you get a reply. Given the size
            of this project the honest commitment is best efforts and a reply
            within the statutory window, not an engineered export tool.
          </p>
          <p>
            Help with a data protection impact assessment means answering your
            questions about how the processing works. The answers are already on{' '}
            <Link
              href="/security"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              /security
            </Link>{' '}
            and on this page.
          </p>
        </LegalSection>

        <LegalSection id="audit" title="Audit">
          <p>
            There is no on-site audit and no questionnaire service. What is
            offered instead is unusually concrete for a supplier this size:{' '}
            <strong>the code is public</strong>, including the database
            migrations that define the access rules, the tests that prove one
            tenant cannot read another, and the history of every change to this
            page. You can read the control rather than ask us to describe it.
          </p>
          <p>
            Written questions get written answers. That is the extent of it, and
            it is stated so that nobody plans an audit around a clause that
            cannot be honoured.
          </p>
        </LegalSection>

        <LegalSection id="deletion" title="Return and deletion">
          {/*
           * **"Delete the workspace" was an instruction to the reader, and
           * there is nothing for them to press.** Project deletion is
           * self-serve; workspace and account deletion exist only as an
           * operator action, and an account is additionally blocked while it
           * owns a workspace because `organizations.created_by` is
           * `on delete restrict`. The cascade is real — every table carrying
           * an `organization_id` declares `on delete cascade` — so the clause
           * was wrong about the mechanism, not the outcome.
           */}
          <p>
            On request, the workspace is deleted and its data goes with it:
            projects, runs, proposed translations, recorded ambiguities, the
            GitHub connection and CLI tokens. Deleting a single project is
            self-serve; deleting the workspace or an account is done by hand,
            because no surface for either exists yet.
          </p>
          <p>
            Nothing has to be exported first, because{' '}
            <strong>there is nothing to export from</strong>: every translation
            that shipped is a commit in your repository and was always yours.
            That is the point of the architecture rather than a clause we are
            pleased to offer.
          </p>
          <p>
            Backups taken by the database provider roll off on that provider’s
            own schedule. Until they do, a deleted row may persist in a backup
            that nothing reads.
          </p>
        </LegalSection>

        <LegalSection id="limits" title="What this agreement is not">
          <StateRule tone="degraded" className="ps-4">
            <p className="text-small leading-6 text-secondary">
              It is offered as it stands and is not negotiated. There is no
              company, no insurance and no indemnity behind it, and it has not
              been reviewed by a lawyer. If your procurement requires a
              negotiated agreement, named security certifications, or a
              counterparty with a legal entity and cover, Layersky cannot meet
              that today — and it is better to know on this page than three
              weeks into a review.
            </p>
          </StateRule>
        </LegalSection>

        <LegalSection id="contact" title="Contact">
          {SUPPORT_EMAIL === null ? (
            <p>
              No private address is published yet, so the only channel is{' '}
              <a
                href={CONTACT_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                the public issue tracker
              </a>
              , which is the wrong place for anything under this agreement.{' '}
              <Link
                href="/contact"
                className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Contact and support
              </Link>
              .
            </p>
          ) : (
            <p>
              Anything under this agreement goes to{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {SUPPORT_EMAIL}
              </a>
              , privately. Bugs and questions about behaviour are better in{' '}
              <a
                href={CONTACT_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                the public issue tracker
              </a>
              , where the answer helps the next person.
            </p>
          )}
        </LegalSection>

        <LegalSection id="changes" title="Changes">
          <p>
            This page is in a public git repository, so every change has a
            commit, a date and a diff. The date at the top is the last one.
            Changes that reduce your protection are not applied to an existing
            workspace without notice.
          </p>
        </LegalSection>
      </LegalPage>
    </>
  );
}
