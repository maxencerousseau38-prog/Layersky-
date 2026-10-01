import { Page } from '@/components/page';
import {
  Skeleton,
  SkeletonTableRows,
  TBody,
  THead,
  Table,
  cn,
} from '@localize-infra/ui';

/**
 * What a page looks like while its query is still running.
 *
 * ## Why these exist at all
 *
 * Every data surface in this application reads Postgres under RLS in a server
 * component, and none had a `loading.tsx`. Next then holds the *previous*
 * route on screen until the new one resolves, so following a link did nothing
 * visible for as long as the query took — the reader clicks, and the product
 * appears not to have noticed.
 *
 * ## Why the geometry is copied rather than approximated
 *
 * A skeleton that is one large rectangle tells the reader something is
 * loading and nothing else, and then the real page lands at a different
 * height and everything jumps. These reproduce the page they replace: the
 * same header block, the same table with the same column count, the same
 * number of rows the route actually renders. The swap should be a change of
 * content, not a change of layout.
 *
 * The row counts are the ones each list shows by default, so a page that
 * loads fast enough to see both frames does not visibly resize.
 *
 * ## Where these must NOT go, and it cost a red test to learn
 *
 * **A route that can call `notFound()` cannot have a `loading.tsx`.** The
 * loading file makes Next stream the response: the shell and this skeleton go
 * out immediately, with a `200` already on the wire, and the page's later
 * `notFound()` can change the body but not the status.
 *
 * Every `/[org]/*` page resolves a workspace and 404s when it is not yours.
 * Adding skeletons there turned `/someone-elses-workspace/usage` from a 404
 * into a 200, which `usage.spec.ts` caught by asserting the status rather
 * than the words on the page — the kind of assertion that looks pedantic
 * until it earns its keep.
 *
 * So these are used only by the global inboxes — `/runs`, `/locales`,
 * `/review`, `/ambiguity` — none of which takes a slug and none of which can
 * 404. `/runs/[id]` is excluded for the same reason as the workspace routes.
 */

/** The title block every page opens with: title, purpose line, meta row. */
export function PageHeaderSkeleton({ meta = 2 }: { meta?: number }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-b border-subtle pb-5">
      <div className="min-w-0">
        {/* 28px tall: the height `PageHeader` renders its `h1` at, so the
            block below it does not move when the real title arrives. */}
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
      </div>
      <div className="flex items-baseline gap-6">
        {Array.from({ length: meta }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a placeholder's only identity is its position, and the row never reorders.
          <Skeleton key={`meta-${i}`} className="h-4 w-24" />
        ))}
      </div>
    </div>
  );
}

/**
 * The summary tiles a page renders above its table.
 *
 * Same geometry as `Metric`: a `rounded-lg` panel with a caption-height label,
 * a figure and a note. Without it, a page that gained tiles would have its
 * table jump down by ~100px the moment the query resolved — the exact defect
 * the file docstring above says these skeletons exist to prevent.
 */
export function MetricGridSkeleton({ tiles = 3 }: { tiles?: number }) {
  return (
    <div
      // The same steps `MetricGrid` uses. A skeleton that reflows at a
      // different width than the thing it stands in for is a layout jump that
      // only appears between two breakpoints, which is where nobody looks.
      className={cn(
        'mt-6 grid gap-3 sm:grid-cols-2',
        tiles === 3 && 'md:grid-cols-3',
        tiles === 4 && 'md:grid-cols-2 xl:grid-cols-4',
      )}
    >
      {Array.from({ length: tiles }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: as above.
          key={`tile-${i}`}
          className="rounded-lg border border-line p-4"
        >
          <Skeleton className="h-3 w-24" />
          {/* 26px: the line box of a `title` figure, so the panel keeps its
              height when the number lands. */}
          <Skeleton className="mt-1.5 h-[26px] w-16" />
          <Skeleton className="mt-2 h-3 w-40 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * A table page: header, an optional summary band, the filter toolbar, rows.
 *
 * `columns` and `rows` are passed by each route rather than defaulted to
 * something plausible, because the whole point is matching the page that is
 * coming — a five-column skeleton in front of a seven-column table is a jump
 * with extra steps.
 */
export function TablePageSkeleton({
  columns,
  rows = 5,
  meta = 2,
  tiles = 0,
  toolbar = true,
}: {
  columns: number;
  rows?: number;
  meta?: number;
  /** Summary tiles between the header and the toolbar, if the route has them. */
  tiles?: number;
  toolbar?: boolean;
}) {
  return (
    <Page>
      <PageHeaderSkeleton meta={meta} />

      {tiles > 0 ? <MetricGridSkeleton tiles={tiles} /> : null}

      {toolbar ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="ms-auto h-4 w-16" />
        </div>
      ) : null}

      <div className="mt-4">
        <Table>
          <THead>
            <tr className="border-b border-subtle">
              {Array.from({ length: columns }, (_, c) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: as above.
                <th key={`head-${c}`} className="h-9 px-3 text-start">
                  <Skeleton className="h-3 w-16" />
                </th>
              ))}
            </tr>
          </THead>
          <TBody>
            <SkeletonTableRows rows={rows} columns={columns} />
          </TBody>
        </Table>
      </div>
    </Page>
  );
}

/** A page built from stacked panels rather than a table. */
export function PanelPageSkeleton({
  panels = 2,
  meta = 2,
}: {
  panels?: number;
  meta?: number;
}) {
  return (
    <Page>
      <PageHeaderSkeleton meta={meta} />
      <div className="mt-6 space-y-4">
        {Array.from({ length: panels }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: as above.
            key={`panel-${i}`}
            // `lg` — the radius DESIGN.md §5.1 gives cards and panels, so the
            // placeholder has the same corner as the thing it stands in for.
            className="rounded-lg border border-line p-5"
          >
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-3 w-full max-w-[52ch]" />
            <Skeleton className="mt-2 h-3 w-full max-w-[38ch]" />
          </div>
        ))}
      </div>
    </Page>
  );
}
