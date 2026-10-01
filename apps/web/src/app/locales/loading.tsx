import { TablePageSkeleton } from '@/components/page-skeleton';

/** `/locales` reads coverage per locale. Six columns, as `LocalesTable` has. */
export default function Loading() {
  return <TablePageSkeleton columns={6} rows={4} meta={2} />;
}
