import { Container, Section } from '@/components/landing/section';
import { SectionHeading } from '@/components/landing/section-heading';
import { SUPPORTED_I18N_LIBRARY } from '@/lib/constants';
import { StateRule } from '@localize-infra/ui';

/**
 * What the check finds, and which single case it fixes.
 *
 * **This section used to be the legacy pipeline.** It drew `PIPELINE_STAGES`
 * — detect, extract, translate, escalate, pull request — under the heading
 * "One command, five stages, no new tab", and that was an accurate
 * description of a product a person starts by hand. It is no longer the thing
 * this page sells, and a landing page whose "How it works" explains a
 * different product than its own headline is the contradiction this pass
 * exists to remove.
 *
 * `PIPELINE_STAGES` itself is untouched. It is DESIGN.md §1.4's vocabulary and
 * it still names the stages of a run on `/runs/[id]` in the hosted app, where
 * that pipeline is real and reached from a button. What changed is which
 * product the landing page leads with, not which products exist.
 */

/**
 * The four things the audit can say, named exactly as `packages/eval/src/audit`
 * emits them.
 *
 * Writing them out rather than describing them in prose is the point: somebody
 * deciding whether to install this needs to know what will appear on their
 * pull requests, and three of these four will never be fixed for them.
 */
const FINDINGS: Array<{
  kind: string;
  what: string;
  fixed: boolean;
  why: string;
}> = [
  {
    kind: 'missing-translation',
    what: 'The source defines a key and a language has no value for it.',
    fixed: true,
    why: 'The only case with one right answer: there is nothing to overwrite.',
  },
  {
    kind: 'placeholder-mismatch',
    what: 'A translation drops or renames a placeholder the source has.',
    fixed: false,
    why: 'Which side is wrong is a judgement, and guessing overwrites a person’s work.',
  },
  {
    kind: 'icu-invalid',
    what: 'An ICU message does not parse — a plural or select form is broken.',
    fixed: false,
    why: 'Same reason, and a rewritten plural can be grammatical and wrong.',
  },
  {
    kind: 'missing-source',
    what: 'A language carries a key the source locale does not.',
    fixed: false,
    why: 'Deleting it is the obvious fix and the destructive one.',
  },
];

export function HowItWorks() {
  return (
    <Section>
      <Container>
        <SectionHeading
          eyebrow="How it works"
          title="It names four problems and fixes one of them"
        >
          <p className="mt-4 max-w-[62ch] text-prose text-secondary">
            A pull request answers for the keys it changed, compared against the
            commit it branched from — never for the backlog its repository has
            never translated. What the check finds goes on the commit. What it
            can fix safely comes back as a pull request of its own, against the
            same branch.
          </p>
        </SectionHeading>

        {/* A table, because the column that matters is the one a paragraph
            would bury: whether a finding gets fixed for you or waits for you. */}
        <div className="mt-10 overflow-x-auto">
          <table
            aria-label="What the check finds and what it fixes"
            className="w-full min-w-[42rem] border-collapse text-start"
          >
            <thead>
              <tr className="border-b border-line">
                <th
                  scope="col"
                  className="py-2.5 pe-4 text-start text-caption font-medium uppercase tracking-wide text-tertiary"
                >
                  Finding
                </th>
                <th
                  scope="col"
                  className="py-2.5 pe-4 text-start text-caption font-medium uppercase tracking-wide text-tertiary"
                >
                  What it means
                </th>
                <th
                  scope="col"
                  className="py-2.5 text-start text-caption font-medium uppercase tracking-wide text-tertiary"
                >
                  Fixed automatically
                </th>
              </tr>
            </thead>
            <tbody>
              {FINDINGS.map((finding) => (
                <tr key={finding.kind} className="border-b border-subtle">
                  <td className="py-4 pe-4 align-top">
                    <code className="font-mono text-small text-primary">
                      {finding.kind}
                    </code>
                  </td>
                  <td className="py-4 pe-4 align-top text-small leading-6 text-secondary">
                    {finding.what}
                  </td>
                  <td className="py-4 align-top text-small leading-6 text-secondary">
                    {/* No tick and no hue. §6.3: colour reports the state of
                        something that exists, and "this product will not touch
                        your file" is not a degraded state — it is the
                        behaviour being promised. */}
                    <span className="font-medium text-primary">
                      {finding.fixed ? 'Yes' : 'No'}
                    </span>
                    <span className="mt-1 block text-tertiary">
                      {finding.why}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* The one step that needs showing rather than describing. */}
        <div className="mt-16 grid gap-8 border-t border-subtle pt-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-16">
          <div>
            <p className="text-eyebrow font-medium uppercase text-tertiary">
              Before it writes anything
            </p>
            <h3 className="mt-3 font-display text-title font-semibold text-primary">
              The fix is audited by the thing that found the problem
            </h3>
            <p className="mt-3 text-prose text-secondary">
              A translation is only committed if re-running the same audit over
              the corrected file says nothing about it. A model that drops a
              placeholder on the way into French is stopped there, before the
              commit, by the code that would otherwise have caught it a check
              later. A translation the model was not sure about is never written
              at all — the question goes on the check instead.
            </p>
          </div>

          <StateRule
            tone="neutral"
            className="rounded-e-lg bg-surface/60 py-5 pe-5"
          >
            <p className="text-small font-medium uppercase tracking-wide text-tertiary">
              On the check, verbatim
            </p>
            <p className="mt-2.5 text-prose text-secondary">
              “the model was not confident and asked: Should the message use
              formal ‘Sie’ or informal ‘du’ address, consistent with the rest of
              the app’s voice?”
            </p>
            <p className="mt-3 text-small leading-6 text-tertiary">
              German register does not follow from one string. Five languages
              landed in that corrective pull request and this one did not, and
              the check says which, and why.
            </p>
          </StateRule>
        </div>

        {/* Scope, stated where somebody deciding whether to install it will
            read it rather than three pages away. */}
        <p className="mt-10 border-t border-subtle pt-6 text-small leading-6 text-tertiary">
          The check reads {SUPPORTED_I18N_LIBRARY} catalogues. next-intl and
          react-intl are recognised and answered with “not supported” rather
          than silence, and a repository it cannot read gets a check saying so —
          never a green one.
        </p>
      </Container>
    </Section>
  );
}
