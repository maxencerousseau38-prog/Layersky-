import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { SITE_URL } from '@/lib/routes';
import { ThemeScript } from '@localize-infra/ui';
import type { Metadata, Viewport } from 'next';
import { Archivo, Inter, JetBrains_Mono } from 'next/font/google';
import type * as React from 'react';
import './globals.css';

// `display: swap` so text is readable during font load; variables are named to
// match the contracts in packages/ui/src/styles/tokens.css.
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

/**
 * Display face. Titles only — never body copy.
 *
 * Deliberately not the interface face: Inter is the right UI font here and the
 * wrong display font, because Inter at display sizes is the default every
 * templated product lands on. See docs/design/09-app-design-direction.md §7.
 */
const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: '/' },
  /*
   * Layersky, not "Localize Infra".
   *
   * The product is called Layersky everywhere a person reads it; "localize-infra"
   * is the repository, the npm scope, the Vercel projects and the GitHub App
   * slug. Those are identifiers with consumers — `@localize-infra/cli` is
   * published and installed by that name — so they are untouched. Only the
   * strings a reader sees change.
   *
   * The description changed for a second reason: it still sold `extract →
   * translate → open a pull request`, which is the product from before the
   * check existed. A search result describing half the product is the version
   * of stale copy nobody on the team ever looks at.
   */
  title: {
    default: 'Layersky — Git-native continuous i18n',
    template: '%s · Layersky',
  },
  description:
    'Layersky reads every pull request and reports what it broke — a missing translation, a dropped placeholder — as a check on the commit. Point the CLI at a repository and it writes the translations too. Your translations stay in your repository.',
  openGraph: {
    type: 'website',
    title: 'Layersky — Git-native continuous i18n',
    description:
      'An i18n check on every pull request, and translations that open as one. Your translations stay in your repository.',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0e12' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${archivo.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh antialiased">
        {/* First focusable element on the page: keyboard and screen-reader
            users should not have to traverse the whole header to reach content. */}
        <a
          href="#main"
          className="sr-only rounded-md bg-primary px-4 text-inverse focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:flex focus:h-8 focus:items-center"
        >
          Skip to content
        </a>
        <div className="flex min-h-dvh flex-col">
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
