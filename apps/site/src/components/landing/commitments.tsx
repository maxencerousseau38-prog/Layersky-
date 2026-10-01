import { Container, Section } from '@/components/landing/section';
import { SectionHeading } from '@/components/landing/section-heading';
import { Badge, StateRule, type Tone } from '@localize-infra/ui';

/**
 * The three commitments.
 *
 * The previous version was three equal cards, which flattened the most
 * interesting thing about this content: each promise is at a *different stage
 * of being kept*. One is working, one is half-built, one is a commitment with
 * no code behind it — and that distinction was a line of small grey text at the
 * bottom of each card.
 *
 * The status is the organising principle: each promise carries its honest state
 * as a badge, and the State Rule runs down the leading edge coloured by whether
 * the promise is actually kept. A reader scanning the rules alone gets the
 * truth.
 *
 * **This paragraph described full-width rows — "the promise at heading scale
 * with its honest state directly beneath, prose to the right".** That version
 * was replaced by the three abreast below, for the reason the implementation
 * comment gives, and this docstring kept describing it. Two accounts of the
 * same component, sixty lines apart, disagreeing about its shape.
 *
 * The rule's tone tracks delivery, not subject matter — the second commitment
 * is *about* ambiguity but is *degraded* in practice, and Iris means one thing
 * in this system: your judgement is required. It is not spent on roadmap state.
 */
const COMMITMENTS: Array<{
  title: string;
  body: string;
  tone: Tone;
  status: string;
  detail?: string;
}> = [
  {
    title: 'Cancel and keep everything',
    body: 'Translations are committed to your repository as ordinary JSON. There is no export step because there is nothing to export from — delete the account, run git pull, everything is still there.',
    tone: 'confident',
    status: 'Working today',
  },
  {
    // The "Close" example that used to carry this promise now lives in How it
    // works, where it is shown rather than described. Repeating it here spent
    // sixty words re-arguing a point the reader has already seen demonstrated.
    title: 'It tells you when it doesn’t know',
    body: 'Strings the model could not resolve are reported as questions, never silently filled in.',
    tone: 'degraded',
    status: 'Partly working',
    // "The queue for resolving them is in development" — it was built and
    // deployed. What keeps this amber is that no real run has used it yet.
    detail:
      'Reported today. The hosted app can hold the pull request until they are answered; no real run has needed it yet.',
  },
  {
    title: 'No counters, ever',
    body: 'Never metered by word, character, key or seat. Your bill does not change shape when your product succeeds. Public repositories are free, permanently.',
    tone: 'neutral',
    status: 'Not built yet',
    detail: 'A commitment, not a feature. Nothing is charged today.',
  },
];

export function Commitments() {
  return (
    <Section>
      <Container>
        {/*
          The template's centred section header — `mx-auto max-w-2xl
          text-center mb-16` — used here and nowhere else on the page.

          This is the one section whose shape matches the one the template
          centres: a header leading a full-width grid of equal cards, which is
          `features-section.tsx` exactly. The sections around it carry
          asymmetric splits, and DESIGN.md §4.4 forbids adjacent sections
          sharing a structural signature — centring all seven would be the
          "document, not a composition" failure that clause names.
        */}
        <SectionHeading
          align="center"
          className="mb-16"
          eyebrow="Commitments"
          title="Three promises, and whether we keep them yet"
        />

        {/*
         * Three abreast, not three stacked essays.
         *
         * As full-width rows these were three ~200px blocks of prose in a page
         * that already had two text sections either side of them, and the middle
         * third of the landing read as one continuous document. Three promises do
         * not need three paragraphs each — they need to be scannable and honest
         * about their state, which is what the rule colour and the badge do.
         *
         * The status board below keeps its rail-and-content split, so the two
         * adjacent sections no longer share a structural signature (DESIGN.md
         * §4.4): three arguments here, eleven measured facts there.
         */}
        <ul className="grid gap-px overflow-hidden rounded-lg border border-subtle bg-subtle md:grid-cols-3">
          {COMMITMENTS.map(({ title, body, tone, status, detail }) => (
            <li key={title} className="bg-canvas">
              <StateRule tone={tone} className="h-full py-6 pe-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                  <h3 className="text-subtitle font-semibold text-primary">
                    {title}
                  </h3>
                  <Badge tone={tone}>{status}</Badge>
                </div>
                <p className="mt-3 text-small leading-6 text-secondary">
                  {body}
                </p>
                {/*
                 * `small`, not `caption`. These are sentences — 21 words in one
                 * case — and `caption` is the 12px step this design system
                 * reserves for labels, code and metadata.
                 *
                 * A visual audit of every 12px element on this page found 77 of
                 * them: 42 monospace, 26 uppercase or letter-spaced labels, 7
                 * short labels, and these two. The page was not typographically
                 * dense, which is what the comparison against the reference
                 * template first concluded; two sentences were wearing a
                 * label's size, and nothing about the scale needed changing.
                 */}
                {detail ? (
                  <p className="mt-2 text-small leading-5 text-tertiary">
                    {detail}
                  </p>
                ) : null}
              </StateRule>
            </li>
          ))}
        </ul>
      </Container>
    </Section>
  );
}
