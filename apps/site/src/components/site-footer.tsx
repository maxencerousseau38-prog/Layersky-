import { GITHUB_REPO_URL } from '@/lib/constants';
import Link from 'next/link';

/**
 * The footer.
 *
 * Was a five-column link grid with a one-line brand blurb — the most templated
 * block on the page, and interchangeable with any other SaaS footer.
 *
 * It now closes the argument instead of merely ending the document. The
 * product's whole thesis is that your translations are files in your
 * repository, so the footer restates that as its final word and shows the
 * artifact it actually produces: the locale files, in the path they are written
 * to. That is the one thing a visitor should remember, and it is content the
 * page already earned rather than decoration added at the end.
 */
const GROUPS: Array<{
  title: string;
  links: Array<{ href: string; label: string; external?: boolean }>;
}> = [
  {
    title: 'Product',
    links: [
      { href: '/docs', label: 'Documentation' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/roadmap', label: 'Roadmap' },
    ],
  },
  {
    title: 'Evidence',
    links: [
      { href: '/benchmarks', label: 'Benchmarks' },
      { href: '/quality', label: 'Quality' },
    ],
  },
  {
    title: 'Trust',
    links: [
      { href: '/security', label: 'Security & data' },
      { href: '/security#subprocessors', label: 'Sub-processors' },
      { href: GITHUB_REPO_URL, label: 'Source on GitHub', external: true },
    ],
  },
  /*
   * Terms, privacy and a contact channel — the three the site did not have.
   *
   * A fourth column rather than appended to Trust: a reader looking for
   * "where do I complain" and a reader looking for "what do you send to a
   * model" are doing different things, and the Trust group is already the
   * answer to the second.
   */
  {
    title: 'Legal',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
      { href: '/dpa', label: 'Data processing' },
      { href: '/contact', label: 'Contact & support' },
    ],
  },
];

const LOCALE_FILES = [
  'locales/en.json',
  'locales/de.json',
  'locales/ja.json',
  'locales/es.json',
  'locales/pt-BR.json',
  'locales/ar.json',
];

export function SiteFooter() {
  return (
    <footer className="border-t border-subtle">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-4">
            <p className="font-display text-title font-semibold text-primary">
              Your translations are files in your repository.
            </p>
            {/* "Not rows in our database" was absolute, on every page, and the
                hosted app does keep a run's proposed translations as rows until
                the pull request lands — that is how it opens exactly what was
                reviewed. The claim that holds is about what ships. */}
            <p className="mt-3 max-w-[42ch] text-body leading-6 text-secondary">
              What ships is a file, not a row in our database. Delete the
              account, run{' '}
              <code className="font-mono text-small text-primary">
                git pull
              </code>
              , and everything that shipped is still there.
            </p>

            {/* The artifact itself, quietly. This is what a run leaves behind,
                in the path it writes to — the product's output as its closing
                statement rather than a logo. */}
            <ul
              aria-label="Files a run writes to your repository"
              className="mt-7 flex flex-wrap gap-x-4 gap-y-1.5"
            >
              {LOCALE_FILES.map((file) => (
                <li key={file} className="font-mono text-caption text-tertiary">
                  {file}
                </li>
              ))}
            </ul>
          </div>

          {/* Four groups now, not three. `sm:grid-cols-2` rather than
              three-across on a phone-and-a-half: four columns at 640 give
              each link list ~140px, which wraps "Contact & support" onto
              three lines. */}
          <div className="grid gap-8 sm:grid-cols-2 lg:col-span-8 lg:col-start-5 lg:grid-cols-4">
            {GROUPS.map((group) => (
              <nav key={group.title} aria-label={group.title}>
                <h2 className="text-eyebrow font-medium uppercase text-tertiary">
                  {group.title}
                </h2>
                <ul className="mt-4 space-y-2.5">
                  {group.links.map((link) => (
                    <li key={`${group.title}-${link.href}`}>
                      {link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="rounded-sm text-body text-secondary transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="rounded-sm text-body text-secondary transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-subtle">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 sm:px-6 lg:px-8">
          <span
            aria-hidden="true"
            className="flex h-3.5 w-3.5 shrink-0 flex-col justify-between py-[1px]"
          >
            <span className="block h-[2px] w-full rounded-full bg-strong" />
            <span className="block h-[2px] w-3/4 rounded-full bg-line" />
            <span className="block h-[2px] w-1/2 rounded-full bg-line" />
          </span>
          {/*
           * The name, which the footer did not carry.
           *
           * The mark beside it was here; the word was not, so the document
           * ended without ever naming what the reader had been reading about.
           * The reference template closes on a wordmark for the same reason,
           * and this is the one thing its footer does that ours did not.
           *
           * `subtitle`, the step the header wordmark uses — the two marks now
           * rank the same, which they should, rather than the closing one
           * being a nameless glyph.
           */}
          <span className="font-display text-subtitle font-semibold text-primary">
            Layersky
          </span>
          <p className="text-small text-tertiary">
            Early access. The CLI and the hosted app both work today; billing
            does not exist yet.
          </p>
        </div>
      </div>
    </footer>
  );
}
