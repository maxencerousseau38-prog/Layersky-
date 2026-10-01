import { AppSidebar } from '@/components/app-sidebar';
import { AppTopbar } from '@/components/app-topbar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { readShellContext } from '@/lib/shell-context';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { isPublicPath } from '@/lib/supabase/session';
import {
  ThemeScript,
  ToastProvider,
  TooltipProvider,
} from '@localize-infra/ui';
import type { Metadata, Viewport } from 'next';
import {
  Archivo,
  Inter,
  JetBrains_Mono,
  Noto_Sans_Arabic,
  Noto_Sans_JP,
} from 'next/font/google';
import { headers } from 'next/headers';
import type * as React from 'react';
import './globals.css';

// `display: swap` so text is readable during font load; variable names match
// the contracts in packages/ui/src/styles/tokens.css.
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

/**
 * Script fonts for translated copy.
 *
 * These complete the `--font-jp` / `--font-ar` stacks in tokens.css, which
 * would otherwise resolve past an undefined variable straight to Inter — and
 * Inter has no CJK or Arabic glyphs, so the browser silently substitutes a
 * system font. That is the exact failure the token file warns about: rendering
 * Japanese in a Latin-first fallback is the fastest way for a localization
 * product to prove it does not care.
 *
 * Loading them here rather than in packages/ui is deliberate — next/font must
 * be called from the app that owns the document. apps/site does not load them
 * because it renders no translated copy.
 *
 * Google splits these into unicode-range chunks and next/font preserves that,
 * so a page showing three Japanese characters fetches one small chunk, not the
 * whole face. The JS budget test in e2e/perf.spec.ts keeps that honest.
 */
const notoSansJP = Noto_Sans_JP({
  // No `subsets`, deliberately. Google exposes no named Japanese subset for
  // this face — CJK is delivered as unicode-range chunks — so naming a subset
  // here yields a font with no CJK glyphs at all, and the stack falls silently
  // through to a system font. That is invisible in the computed font-family;
  // it was caught by measuring rendered glyph widths, and a test now pins it.
  //
  // `preload: false` follows from the same fact: there is no single file to
  // preload, and preloading every chunk would cost far more than it saves.
  preload: false,
  variable: '--font-noto-jp',
  display: 'swap',
});

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-noto-ar',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    /*
     * Layersky, the product. `localize-infra` stays wherever it is an
     * identifier with consumers — the repository, the npm scope, the Vercel
     * projects, and the GitHub App, whose display name GitHub reports as
     * "Localize Infra". The three strings telling a reader what to authorise
     * name that App and are deliberately unchanged: renaming them would make
     * the instruction disagree with the screen GitHub shows.
     */
    default: 'Layersky',
    template: '%s · Layersky',
  },
  description: 'Localization infrastructure for product teams.',
  // The app is not public content. Indexing it would surface screens that
  // announce their own absence, which is honest but not useful in search.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0c0e12' },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Set per request in src/proxy.ts. Reading it here is what forces this
  // app to render dynamically — the deliberate cost of a strict CSP on a
  // surface that will render user data.
  const headerList = await headers();
  const nonce = headerList.get('x-nonce') ?? undefined;

  /*
   * Whether this request is inside the application.
   *
   * `/login` was being served wrapped in the full shell: the workspace
   * navigation, a Review badge reading "3", and a footer explaining that the
   * screens listed above show sample data — to a visitor with no session, for
   * whom every one of those links redirects straight back to the form they are
   * looking at. Chrome advertising surfaces the reader cannot reach, and a
   * count of somebody else's work.
   *
   * The answer comes from `isPublicPath`, the same allow-list the proxy
   * enforces with, so the set of routes that are outside the application is
   * stated once. A missing header means the proxy did not run, which only
   * happens for paths its matcher excludes — none of which render this layout —
   * so the shell is the safe default.
   */
  const pathname = headerList.get('x-pathname');
  const inApp = pathname === null || !isPublicPath(pathname);

  // Read once here rather than in the sidebar: the sidebar is a client
  // component, and a second round trip for the reader's own address would be
  // a request per navigation for something this render already knows.
  const shell = inApp ? await readShellContext(pathname) : null;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${archivo.variable} ${jetbrainsMono.variable} ${notoSansJP.variable} ${notoSansArabic.variable}`}
    >
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className="antialiased">
        {/* First focusable element on the page: keyboard and screen-reader
            users should not have to traverse the whole shell to reach content. */}
        <a
          href="#main"
          className="sr-only rounded-md bg-primary px-4 text-inverse focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:flex focus:h-8 focus:items-center"
        >
          Skip to content
        </a>
        {/* SidebarProvider owns the collapse state, the ⌘B shortcut, and the
            switch to a Sheet below the mobile breakpoint. The shell was a bare
            flex row with a hand-rolled column and a second copy of the
            navigation living in the topbar; all of that is now one component
            tree with one source of truth. */}
        {/* ToastProvider carries only the viewport and the queue; it renders
            nothing until something is pushed. It sits outside the shell so a
            message survives the surface that caused it being replaced — which
            is the only case this product uses a toast for. */}
        <ToastProvider>
          <TooltipProvider delayDuration={400}>
            {inApp ? (
              <SidebarProvider className="h-dvh min-h-0">
                <AppSidebar
                  sampleData={!isSupabaseConfigured()}
                  orgSlug={shell?.orgSlug ?? null}
                  account={shell?.account ?? null}
                />
                <SidebarInset className="min-w-0 overflow-hidden">
                  {/* The same validated slug the sidebar gets. The topbar
                      needs it to name a workspace route in the breadcrumb, and
                      taking it from `usePathname` there would relabel the bar
                      for a workspace the reader is not a member of. */}
                  <AppTopbar orgSlug={shell?.orgSlug ?? null} />
                  <main id="main" className="flex-1 overflow-y-auto">
                    {children}
                  </main>
                </SidebarInset>
              </SidebarProvider>
            ) : (
              /*
               * Outside the application: the page, and nothing around it.
               *
               * `main#main` stays, because the skip link above targets it and a
               * page without it would make that link dead — an accessibility
               * failure that looks like nothing. `h-dvh` stays too, so the
               * sign-in form keeps the full-height column it was centring in.
               *
               * ThemeProvider-ish wrappers stay above: a signed-out visitor
               * still gets their colour scheme, and a toast raised here would
               * still have somewhere to land.
               */
              <main id="main" className="h-dvh overflow-y-auto">
                {children}
              </main>
            )}
          </TooltipProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
