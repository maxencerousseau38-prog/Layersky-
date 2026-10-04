import { LegalList, LegalPage, LegalSection } from '@/components/legal-prose';
import { PageHeader } from '@/components/page-header';
import {
  CONTACT_URL,
  GITHUB_REPO_URL,
  LEGAL_LAST_UPDATED,
  OPERATOR,
  SUPPORT_EMAIL,
} from '@/lib/constants';
import { StateRule } from '@localize-infra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  alternates: { canonical: '/contact' },
  title: 'Contact & support',
  description:
    'The one channel this project has, what it is good for, what it is not, and how quickly you should expect an answer.',
};

/**
 * One channel, and the honest version of what it is.
 *
 * A contact page usually exists to make a product look staffed. This one
 * exists because a first external team needs to know where a problem goes,
 * and the true answer — a public issue tracker, answered by one person, with
 * no committed response time — is more useful than a form that reaches an
 * inbox nobody has promised to read.
 *
 * No form, deliberately. A form here would have to post somewhere, and this
 * site is static with no backend of its own (`ACCOUNT_BACKEND`), so it would
 * either be decorative or quietly send your message to a third party.
 */
export default function ContactPage() {
  return (
    <>
      <PageHeader
        eyebrow="Support"
        title="Contact"
        lede="There is one channel and one person. This page says what that gets you, so you can decide whether it is enough before you depend on it."
      />

      <LegalPage updated={LEGAL_LAST_UPDATED}>
        <LegalSection id="channel" title="Where to write">
          <p>
            In public,{' '}
            <a
              href={CONTACT_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              open an issue on GitHub
            </a>
            . That is the right place for a bug, a repository layout the check
            does not understand, or a question whose answer helps the next
            person too.
          </p>
          {SUPPORT_EMAIL === null ? (
            <p>
              <strong>In private, nowhere yet.</strong> No support address is
              published because none exists, and printing one that receives no
              mail would be worse than admitting the gap — the first person to
              find out would be somebody who had already trusted it with
              something they could not post in public.
            </p>
          ) : (
            <p>
              In private,{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                {SUPPORT_EMAIL}
              </a>
              . Use it for anything you cannot put on a public page: a data
              request, an error quoting a private repository, or anything under{' '}
              <Link
                href="/dpa"
                className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                the data processing agreement
              </Link>
              .
            </p>
          )}
          <p>
            {OPERATOR}. One person reads both, in one timezone, with no
            committed response time. A message may be answered the same hour or
            the following week. There is no chat, no ticketing system and no
            phone number.
          </p>
        </LegalSection>

        <LegalSection id="good-for" title="What it is good for">
          <LegalList
            items={[
              {
                id: 'wrong-check',
                body: 'A check that reported something wrong, or missed something it should have caught — attach the pull request if the repository is public.',
              },
              {
                id: 'bad-translation',
                body: 'A corrective pull request that wrote a bad translation.',
              },
              {
                id: 'unsupported-layout',
                body: 'An i18n library or catalogue layout Layersky does not understand.',
              },
              {
                id: 'data-question',
                body: 'A question about what the product does with your code that /security does not already answer.',
              },
              {
                id: 'oss-bug',
                body: 'A bug in the open-source packages, which are MIT-licensed and take pull requests.',
              },
            ]}
          />
        </LegalSection>

        <LegalSection
          id="not-for"
          title="What the public tracker is not good for"
        >
          <StateRule tone="degraded" className="ps-4">
            <p className="text-body font-medium text-primary">
              Anything confidential.
            </p>
            <p className="mt-2 text-small leading-6 text-secondary">
              GitHub issues are public and indexed. Do not put a private
              repository’s source, a token, an error containing a key, or a
              personal data request into one.{' '}
              {SUPPORT_EMAIL === null ? (
                <>
                  There is currently no private channel to use instead, which is
                  a real limitation and is also stated on{' '}
                  <Link
                    href="/privacy#gaps"
                    className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    the privacy page
                  </Link>
                  .
                </>
              ) : (
                <>
                  Send those to{' '}
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {SUPPORT_EMAIL}
                  </a>{' '}
                  instead.
                </>
              )}
            </p>
          </StateRule>
          <p>
            A suspected security vulnerability is the one case where a public
            issue is clearly the wrong move. Use GitHub’s private vulnerability
            reporting on{' '}
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              the repository
            </a>{' '}
            instead, which reaches the maintainer without publishing anything.
          </p>
        </LegalSection>

        <LegalSection id="before" title="Before you write">
          <p>
            Two pages answer most of it, and both are written to be read rather
            than to reassure:{' '}
            <Link
              href="/docs"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              the documentation
            </Link>{' '}
            for what the product does and what it refuses to do, and{' '}
            <Link
              href="/security"
              className="rounded-sm text-link underline underline-offset-2 hover:text-link-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              security &amp; data
            </Link>{' '}
            for what it reads and where that goes.
          </p>
        </LegalSection>
      </LegalPage>
    </>
  );
}
