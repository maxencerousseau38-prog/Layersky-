import { PageHeader } from '@/components/page-header';
import { Badge, StatusDot } from '@localize-infra/ui';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  alternates: { canonical: '/roadmap' },
  title: 'Roadmap',
  description:
    'What is shipped, what is built but not yet proven on a real run, what is planned, and what is deliberately out of scope.',
};

/**
 * Three states, each checkable.
 *
 * This page had "Being built" and "Planned", and both were wrong in the same
 * direction as the landing page's status board:
 *
 *   - "Being built" held placeholder-aware extraction and the typed SDK.
 *     Extraction had not changed since 2026-08-02, and no SDK code or commit
 *     existed. Nothing was being built.
 *   - "Planned" held the ambiguity review queue and hosted accounts, both of
 *     which were already deployed.
 *
 * So `building` is gone. `unproven` is for what exists and is deployed but has
 * never done its job on a real run — a different claim from "shipped", and one
 * a reader should be able to tell apart.
 */
type Status = 'shipped' | 'unproven' | 'planned';

const STAGES: {
  status: Status;
  label: string;
  items: { title: string; body: string }[];
}[] = [
  {
    status: 'shipped',
    label: 'Shipped',
    items: [
      /*
       * First, and it was missing entirely.
       *
       * This list opened with the evaluation harness and the CLI, which is
       * the order the product shipped in and no longer the order it matters
       * in. A reader scanning for what Layersky does would have found the
       * i18n check nowhere on its own roadmap while it was running against a
       * real repository every day.
       */
      {
        title: 'i18n check on every pull request',
        body: 'A GitHub App that reads the catalogues a pull request changed and posts a check on the commit — missing translations, dropped placeholders, invalid ICU, keys the source no longer has. It answers only for what the pull request changed, never for the repository’s backlog, and its conclusion is always neutral so it cannot block a merge.',
      },
      {
        title: 'Automatic correction of missing translations',
        body: 'The one finding with a single right answer is fixed in a pull request opened against your branch, so merging it re-runs the check that asked for it. The corrected file is re-audited before anything is committed, and a translation the model was not confident about is reported as a question instead of written. The other three findings are never rewritten.',
      },
      {
        title: 'Quality evaluation harness',
        body: 'A corpus of 414 real strings from five open-source projects, with deterministic placeholder, ICU and plural checks enforced on every build. The same placeholder and ICU code is what the pull request check runs.',
      },
      {
        title: 'CLI: extract, translate, open a pull request',
        /*
         * Two claims here had gone stale, in opposite ways.
         *
         * "an API you run yourself" was true of 0.2.0 and has not been since
         * 0.3.0: `DEFAULT_API_URL` is the hosted service and a personal token
         * is created in the app. Self-hosting is still supported — it is now
         * the option rather than the only path.
         *
         * "never overwrites hand-edited translations" is true of values and
         * false of keys. The merge is rebuilt from the fresh extraction, so a
         * key extraction does not produce is dropped; `init` guards that for
         * `en.json` only. Probed against the published package — see the
         * merging section in /docs, which now states it.
         */
        body: 'On npm as @localize-infra/cli. Framework detection, AST extraction, per-language failure isolation, a merge that keeps hand-edited translations for every key extraction still finds, and pull request creation through a GitHub App. A run that would change nothing opens no pull request. It translates through the hosted API with a personal token, or through one you run yourself.',
      },
      {
        title: 'Hosted app',
        body: 'Accounts, workspaces with roles, projects, a GitHub connection per workspace, and runs started from the browser that end in a pull request. Early access: public and private repositories are both self-serve, and nothing is charged.',
      },
    ],
  },
  {
    status: 'unproven',
    label: 'Built, not yet used on a real run',
    items: [
      {
        title: 'Answering unresolved strings',
        body: 'When the model raises a question, the hosted app holds the run, lists the question with the alternatives the model gave, and opens the pull request only once every question is answered — committing the reviewed translations, not a fresh sample. It is deployed, and no real run has raised a question yet, so it has not been exercised outside tests.',
      },
    ],
  },
  {
    status: 'planned',
    label: 'Planned, not started',
    items: [
      /*
       * Named because the check's scope is the first question anybody using
       * another library will ask, and a roadmap that is silent about it reads
       * as "coming soon" to somebody who has not got as far as /docs.
       */
      {
        title: 'next-intl and react-intl',
        body: 'The pull request check reads i18next catalogues. The other two are detected and answered with “not supported” rather than silence — which is a better answer than nothing and is still not support. Neither is being built today.',
      },
      {
        title: 'Blocking the check on failure',
        body: 'The check is always neutral, so it cannot stop a merge. Making it capable of failing is a small change and will not be made on a guess: it stops somebody else’s work, so it waits until somebody asks for it.',
      },
      {
        title: 'Placeholder-aware extraction',
        body: 'A sentence containing an expression — “You have {count} messages” — is currently extracted as separate fragments. Translating fragments independently breaks word order in German, Japanese and Arabic. It is first on this list, and no broader quality claim will be made until it is fixed.',
      },
      {
        title: 'Typed SDK',
        body: 'Generated types from your key catalogue, so a missing key fails the build rather than reaching a user as a blank space.',
      },
      {
        title: 'Visual context capture',
        body: 'Per-component screenshots collected in CI, so the translator — human or model — can see where a string appears before choosing a word.',
      },
      {
        title: 'Review surface for non-developers',
        body: 'A way for the person who notices the German call-to-action reads like a legal notice to fix it, without seeing a key, a file path, or a merge conflict.',
      },
      {
        title: 'Billing',
        // "That model does not exist yet" was true when written and is not now:
        // `packages/pricing` generates it and a production run has been
        // measured. What blocks a price is the commercial decision and the
        // absence of anyone who has agreed to pay one — not the cost side.
        body: 'Plans and payment. What the service costs to run is modelled, and one production run has been measured; no price is published because the commercial figures are not decided and no customer has yet agreed to pay one.',
      },
    ],
  },
];

/**
 * Only shipped capability carries colour (DESIGN.md §6.2, §6.3).
 *
 * `building` was Iris, which in this system means one thing — your judgement is
 * required — and a roadmap item requires nothing of the reader. Spending the
 * ambiguity colour on maturity state is the same leak that was already removed
 * from the landing page's status board, and it had spread to four more pages.
 * `unproven` is neutral for the same reason: it is a maturity state.
 */
const TONE: Record<Status, 'confident' | 'neutral'> = {
  shipped: 'confident',
  unproven: 'neutral',
  planned: 'neutral',
};

export default function RoadmapPage() {
  return (
    <>
      <PageHeader
        eyebrow="Build status"
        title="What is shipped, and what is not"
        lede="Stated in the past and future tense correctly, which is rarer than it should be."
      />

      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="space-y-14">
          {STAGES.map((stage) => (
            <section
              key={stage.status}
              aria-labelledby={`stage-${stage.status}`}
            >
              <div className="flex items-center gap-3">
                <h2
                  id={`stage-${stage.status}`}
                  className="font-display text-headline font-semibold text-primary"
                >
                  {stage.label}
                </h2>
                <Badge tone={TONE[stage.status]}>{stage.items.length}</Badge>
              </div>
              {/*
               * Rows, not a grid of bordered cards.
               *
               * This was `rounded-lg border p-5` repeated in two columns, which
               * is the repetitive-card shape the landing page moved away from:
               * a border around every item groups nothing, because every item
               * is already in a list under a heading that names the group.
               *
               * It also matches the status board on the landing page now. That
               * board and this page are the same information at two depths, and
               * they were drawn as unrelated things — a dotted list there, a
               * card grid here. One language: a marker carrying state, a title,
               * and the reasoning beside it.
               */}
              <ul className="mt-5 border-t border-subtle">
                {stage.items.map((item) => (
                  <li
                    key={item.title}
                    className="grid gap-x-10 gap-y-1.5 border-b border-subtle py-4 lg:grid-cols-12"
                  >
                    <h3 className="lg:col-span-4">
                      <StatusDot tone={TONE[stage.status]}>
                        <span className="font-medium">{item.title}</span>
                      </StatusDot>
                    </h3>
                    <p className="text-body leading-6 text-secondary lg:col-span-8">
                      {item.body}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <section
          aria-labelledby="out-of-scope"
          className="mt-16 border-t border-subtle pt-10"
        >
          <h2
            id="out-of-scope"
            className="text-title font-semibold text-primary"
          >
            Deliberately not building
          </h2>
          <p className="mt-3 max-w-[64ch] text-body leading-6 text-secondary">
            A translator marketplace, a full CAT editor, vendor management, or
            project management with assignments and due dates. These are the
            features that made existing localization platforms slow and
            expensive. Saying no to them is a product decision, not an
            oversight.
          </p>
        </section>
      </div>
    </>
  );
}
