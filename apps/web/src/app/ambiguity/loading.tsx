import { PanelPageSkeleton } from '@/components/page-skeleton';

/** `/ambiguity` renders one panel per question awaiting an answer. */
export default function Loading() {
  return <PanelPageSkeleton panels={2} meta={1} />;
}
