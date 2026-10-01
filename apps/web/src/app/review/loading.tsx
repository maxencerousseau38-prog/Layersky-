import { PanelPageSkeleton } from '@/components/page-skeleton';

/**
 * `/review` groups proposals by run rather than listing rows, so the panel
 * shape stands in for it — a table skeleton here would promise a table the
 * page does not render.
 */
export default function Loading() {
  return <PanelPageSkeleton panels={2} meta={2} />;
}
