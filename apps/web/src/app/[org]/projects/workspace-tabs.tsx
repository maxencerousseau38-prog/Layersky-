'use client';

import { useUrlFilter } from '@/lib/use-table-query';
import {
  Badge,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
} from '@localize-infra/ui';
import type * as React from 'react';

/**
 * Two surfaces of this page, separated because they are used at different
 * frequencies — not because the reference template has tabs.
 *
 * ## What the measurement said
 *
 * Setup already sat *below* the work, which was the right call and is recorded
 * as such in the page's own comment. It stops being enough once the list is
 * long: with twelve projects the GitHub panel began at y=1253 and Activation at
 * y=1380, so on a 900px viewport both were two screens down. A panel whose
 * position depends on how many projects you have is not a place; it is wherever
 * the list happens to end.
 *
 * Tabs give them a fixed address. Nothing is deleted and nothing is
 * conditional: the same two panels, the same content, one click away instead of
 * one thousand two hundred pixels.
 *
 * ## Why the split is along this line and no other
 *
 * Projects is the work, done continuously. GitHub is connected once and changed
 * almost never. Activation is a read-only funnel nobody acts on. Splitting
 * "things you do" from "things you did once" is a real functional boundary;
 * splitting a table into "recent" and "all" would not be.
 *
 * ## The trigger reports state, because hiding a panel must not hide its state
 *
 * The honest objection to tabs here is that a workspace with no GitHub
 * installation most needs the panel it can no longer see. So the trigger says
 * so, in words — `Badge` carries text, never colour alone (§13, WCAG 1.4.1) —
 * and only when it is true: being connected is the resting state and gets no
 * marker, which is the same rule `readiness` applies to a project that is
 * simply not finished yet (§6.3).
 *
 * The guided path at `/[org]/start` remains linked from the row above these
 * tabs, outside them, where it is reachable whichever tab is open. That is the
 * surface actually designed to answer "what do I do next"; this page's job is
 * not to re-answer it.
 *
 * ## The tab lives in the URL, but the URL does not drive the tab
 *
 * §9: "Filters, tabs, selections and pagination live in the URL and survive
 * reload and sharing." `useUrlFilter` is the hook the list's own filter uses,
 * so a link to `?tab=setup` opens on setup, and the default writes nothing to
 * the address bar.
 *
 * It is `defaultValue`, not `value`, and that is not a shortcut. Driving a
 * controlled `value` from `useSearchParams` makes every tab click wait for
 * `router.replace` to round-trip the server component and its four queries
 * before anything moves — measured, not supposed: clicking Setup left the
 * GitHub panel unrendered, and the panel was not hidden by CSS, it had not
 * been sent yet. A tab that pauses on a database is not a tab.
 *
 * Uncontrolled, Radix switches on the click and the URL is written after, so
 * the address stays shareable and the interaction stays local. The cost is
 * that browser back does not step through tab changes — which `router.replace`
 * had already decided, since it deliberately does not push history for a
 * filter.
 */
export function WorkspaceTabs({
  projects,
  setup,
  githubConnected,
  projectCount,
}: {
  projects: React.ReactNode;
  setup: React.ReactNode;
  githubConnected: boolean;
  projectCount: number;
}) {
  const [tab, setTab] = useUrlFilter<'projects' | 'setup'>('tab', 'projects');

  return (
    <TabsRoot
      defaultValue={tab}
      onValueChange={(next) => setTab(next as 'projects' | 'setup')}
      /* `mt-4`, not `mt-6`. §4.6 budgets roughly a third of the first
         viewport for chrome before the first row of real content; header,
         workspace links, tab bar and toolbar already spend 332px of 900. */
      className="mt-4"
    >
      <TabsList>
        <TabsTrigger value="projects">
          Projects
          {/*
            The count, beside the label rather than only in the header.
            A tab that hides a list should say how much it is hiding.
          */}
          {projectCount > 0 ? (
            <span className="ms-1.5 font-mono text-caption text-tertiary">
              {projectCount}
            </span>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="setup">
          Setup
          {githubConnected ? null : (
            <Badge tone="neutral" className="ms-2">
              GitHub not connected
            </Badge>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="projects">{projects}</TabsContent>
      <TabsContent value="setup">{setup}</TabsContent>
    </TabsRoot>
  );
}
