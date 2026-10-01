import { TablePageSkeleton } from '@/components/page-skeleton';

/**
 * `/runs` reads `runs` under RLS in a server component, so the route suspends.
 * Seven columns and three rows: the shape `RunsTable` renders, including the
 * filter toolbar above it, so the swap changes content and not layout.
 *
 * One metadata fact and three tiles, matching the page: Succeeded moved out of
 * the header into the summary band, so the header lost an item and the space
 * below it gained a row.
 */
export default function Loading() {
  return <TablePageSkeleton columns={7} rows={3} meta={1} tiles={3} />;
}
