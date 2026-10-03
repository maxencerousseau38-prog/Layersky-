import { Container, Section } from '@/components/landing/section';
import { FIXTURE_REPO_URL } from '@/lib/constants';
import { Check, GitPullRequest, X } from 'lucide-react';

/**
 * The half of the product this page did not mention.
 *
 * Every section before this described `extract → translate → open a pull
 * request`, which is what Layersky was when the page was written. It is no
 * longer only that: a pull request now gets an i18n check on the commit, and
 * that half runs on every push and needs nobody to remember it.
 *
 * ## The evidence is a real check
 *
 * The numbers are the output of the check on pull request #14 of the i18next
 * fixture, read from the GitHub API on 2026-09-29: two keys examined against
 * six languages, two placeholder mismatches, each naming the token it lost.
 * The alternative was a mock-up of a check, which is the kind of screenshot
 * this page exists not to publish.
 *
 * No link. The fixture is public but the pull request is a test artefact, and
 * linking to it would dress a fixture as a case study — `EXAMPLE_PR_URL` is
 * null for the same reason further up, and an e2e test forbids the link.
 *
 * ## Two things this had wrong before it was right
 *
 * It was built on `surface/40` and inserted directly above `Ecosystem`, which
 * is also `surface/40` — two adjacent sections on one ground, breaking the
 * alternation `page.tsx` documents. The §4.4 test passed anyway, because it
 * compares column counts and evidence rather than colour: the rule was broken
 * while its proxy held.
 *
 * Then the dark version reached for `bg-inverse-surface` and
 * `border-inverse-subtle`, **neither of which exists**. DESIGN.md §16 is
 * explicit that a value not in the document is either an existing token or an
 * amendment with reasoning, and inventing a token name that silently resolves
 * to nothing is the version of that mistake which still renders. The band is
 * `bg-primary` and the panel inside it is a light card, which is exactly what
 * the run artifact in the hero already does on the same ground.
 */

/** What the check reported, verbatim. Changing these means re-running it. */
const FINDINGS = [
  {
    locale: 'fr',
    key: 'common:notifications.unread',
    detail: 'drops {{count}}',
  },
  { locale: 'fr', key: 'common:auth.greeting', detail: 'drops {{name}}' },
] as const;

/** What it does not complain about — the half that decides whether it lives. */
const QUIET = [
  'Keys the pull request did not touch',
  'Translations somebody edited by hand',
  'Languages whose placeholders still line up',
] as const;

export function ContinuousCheck() {
  return (
    <Section
      ground="inverse"
      aria-label="The check Layersky puts on a pull request"
    >
      {/* `sm:py-28`, the step every other section on this page uses. It shipped
          at `sm:py-24` in the tranche that added it — the one genuine rhythm
          inconsistency on the landing, and it was mine. */}
      <Container>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start lg:gap-16">
          <div>
            <p className="text-eyebrow font-medium uppercase text-inverse/60">
              On every pull request
            </p>
            <h2 className="mt-3 max-w-[20ch] font-display text-display font-semibold text-inverse sm:text-display-lg">
              It reads the diff before a reviewer does
            </h2>
            <p className="mt-5 max-w-[46ch] text-prose text-inverse/80">
              Install the GitHub App and every pull request gets a check on the
              commit. It compares what changed against the base, so the pull
              request answers for the keys it touched — never for the backlog
              its repository has never translated.
            </p>

            <ul className="mt-8 space-y-3 border-t border-inverse/15 pt-6">
              {QUIET.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check
                    aria-hidden="true"
                    strokeWidth={2.5}
                    className="mt-0.5 size-3.5 shrink-0 text-inverse/50"
                  />
                  <span className="text-small leading-5 text-inverse/70">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
            {/*
             * `/60`, not `/50`. At 13px on this band `/50` measures 3.54:1 and
             * axe wants 4.5 — caught by the dark-scheme run, which is the only
             * place it fails. Every other dark band on this page already uses
             * `/60`; reaching for a weaker step was the mistake, not the
             * threshold.
             */}
            <p className="mt-4 text-small leading-5 text-inverse/60">
              A check that reports everything wrong with a repository is turned
              off within a week.
            </p>
          </div>

          {/* The check, as a light card on the dark ground — the treatment the
              run artifact in the hero already uses for evidence. */}
          <figure className="overflow-hidden rounded-xl border border-line bg-canvas shadow-e2">
            <figcaption className="flex items-center gap-2.5 border-b border-subtle bg-surface/60 px-4 py-2.5 sm:px-5">
              <GitPullRequest
                aria-hidden="true"
                className="size-4 shrink-0 text-tertiary"
              />
              <span className="font-mono text-small text-secondary">
                Layersky i18n
              </span>
              {/*
               * Graphite, not crimson. The conclusion is `neutral`: the check
               * reports and blocks nothing. Drawing it as a failure would
               * assert behaviour the product does not have — §6.3, colour
               * reports the state of something that exists.
               */}
              <span className="ms-auto rounded-sm border border-strong px-1.5 py-0.5 text-caption uppercase tracking-wide text-tertiary">
                Neutral
              </span>
            </figcaption>

            <div className="px-4 py-4 sm:px-5 sm:py-5">
              <p className="font-display text-subtitle font-semibold text-primary">
                2 i18n problems
              </p>
              <p className="mt-1 text-small leading-5 text-tertiary">
                Checked 2 keys against 6 languages (ar, de, es, fr, ja, pt-BR).
              </p>

              <ul className="mt-4 space-y-2.5">
                {FINDINGS.map((finding) => (
                  <li key={finding.key} className="flex items-start gap-2.5">
                    <X
                      aria-hidden="true"
                      strokeWidth={2.5}
                      className="mt-0.5 size-3.5 shrink-0 text-tertiary"
                    />
                    <span className="min-w-0 text-small leading-5 text-secondary">
                      <code className="font-mono text-tertiary">
                        {finding.locale}
                      </code>{' '}
                      <code className="font-mono text-primary">
                        {finding.key}
                      </code>{' '}
                      {finding.detail}
                    </span>
                  </li>
                ))}
              </ul>

              {/*
               * The correction section of the check, verbatim.
               *
               * It was missing, and its absence was the page's largest
               * remaining gap: the product fixes what is safe and this card
               * showed only the finding half, so a reader had no way to know
               * which of the two happened here. On this pull request the
               * answer is neither — both findings are placeholder
               * mismatches, which are never corrected automatically, and the
               * check says so in those words.
               */}
              <div className="mt-4 border-t border-subtle pt-4">
                <p className="text-caption font-medium uppercase tracking-wide text-tertiary">
                  Automatic correction
                </p>
                <p className="mt-1.5 text-small leading-5 text-secondary">
                  Nothing was translated. Nothing here is safe to correct
                  automatically.
                </p>
              </div>
              <p className="mt-4 text-small leading-5 text-tertiary">
                A dropped placeholder renders the literal token to a user, or
                throws. It is the failure that survives review, because the file
                it lives in is the one nobody reads.
              </p>
            </div>
          </figure>
        </div>

        <p className="mt-6 text-small text-inverse/60">
          Pull request{' '}
          <a
            href={`${FIXTURE_REPO_URL}/pull/14`}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-sm text-inverse underline underline-offset-2 decoration-inverse/40 hover:decoration-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            #14
          </a>{' '}
          on our i18next fixture, 2 October 2026. The repository is public, so
          this is the check itself rather than a description of one.
        </p>
      </Container>
    </Section>
  );
}
