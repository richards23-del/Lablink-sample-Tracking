import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
import type { Priority, SampleStatus } from '@shared/types';
import { useSamples, useSession } from '@/lib/api';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SampleRow,
  SectionHeading,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import CreateSampleDialog from '@/features/samples/create-dialog';
import { fieldClass } from '@/features/samples/form-fields';

const statuses: { value: SampleStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'received', label: 'Received' },
  { value: 'processing', label: 'Processing' },
  { value: 'verification', label: 'Awaiting verification' },
  { value: 'completed', label: 'Completed' },
  { value: 'delayed', label: 'Overdue' },
  { value: 'recollection', label: 'Recollection' },
];
const pageSize = 20;

export default function SamplesPage() {
  const [, navigate] = useLocation();
  const session = useSession();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<SampleStatus | ''>('');
  const [priority, setPriority] = useState<Priority | ''>('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useSamples({
    search: debouncedSearch,
    status,
    priority,
    page,
    pageSize,
  });
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filtered = !!(debouncedSearch || status || priority);

  useEffect(() => {
    if (query.data && page > totalPages) setPage(totalPages);
  }, [query.data, page, totalPages]);

  function clearFilters() {
    setSearch('');
    setDebouncedSearch('');
    setStatus('');
    setPriority('');
    setPage(1);
  }

  return (
    <div className="page-enter">
      <SectionHeading
        eyebrow="Specimen operations"
        title="Sample queue"
        description="Track each specimen from receipt through review and release."
        action={
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              aria-label="Refresh sample queue"
            >
              <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            {(session.data?.user?.role === 'admin' ||
              session.data?.user?.role === 'technician') && (
              <Button
                type="button"
                onClick={() => setCreateOpen(true)}
                data-testid="button-register-sample"
              >
                <Plus />
                Register sample
              </Button>
            )}
          </div>
        }
      />
      <div className="mb-5 grid gap-3 rounded-xl border border-card-border bg-card p-4 panel-shadow sm:grid-cols-[minmax(0,1fr)_180px_150px]">
        <div>
          <label
            htmlFor="sample-search"
            className="mb-1.5 block text-xs font-semibold"
          >
            Search samples
          </label>
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-3 text-muted-foreground"
            />
            <input
              id="sample-search"
              type="search"
              maxLength={160}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sample, patient, test or facility"
              className={`${fieldClass} pl-9`}
            />
          </div>
        </div>
        <div>
          <label
            htmlFor="sample-status"
            className="mb-1.5 block text-xs font-semibold"
          >
            Status / turnaround
          </label>
          <select
            id="sample-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as SampleStatus | '');
              setPage(1);
            }}
            className={fieldClass}
          >
            {statuses.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label
            htmlFor="sample-priority"
            className="mb-1.5 block text-xs font-semibold"
          >
            Priority
          </label>
          <select
            id="sample-priority"
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value as Priority | '');
              setPage(1);
            }}
            className={fieldClass}
          >
            <option value="">All priorities</option>
            <option value="routine">Routine</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>
      {status === 'delayed' && (
        <p className="mb-4 text-sm text-muted-foreground">
          Showing active specimens past their turnaround target. Each specimen
          retains its current workflow status.
        </p>
      )}
      <div
        className="overflow-hidden rounded-xl border border-card-border bg-card panel-shadow"
        aria-busy={query.isFetching}
      >
        {query.isLoading ? (
          <div className="p-5">
            <LoadingState rows={6} />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data?.items.length ? (
          <>
            <div className="divide-y divide-border">
              {query.data.items.map((sample) => (
                <SampleRow key={sample.id} sample={sample} />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
              <p className="text-xs text-muted-foreground" aria-live="polite">
                Showing {(page - 1) * pageSize + 1}–
                {Math.min(page * pageSize, total)} of {total} samples
              </p>
              <nav
                aria-label="Sample pages"
                className="flex items-center gap-3"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Previous page"
                  disabled={page <= 1 || query.isFetching}
                  onClick={() => setPage((current) => current - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span className="text-xs">
                  Page {page} of {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Next page"
                  disabled={page >= totalPages || query.isFetching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  <ChevronRight />
                </Button>
              </nav>
            </div>
          </>
        ) : (
          <>
            <EmptyState
              title={filtered ? 'No matching samples' : 'No samples registered'}
              description={
                filtered
                  ? 'Try another search or clear the filters to see the full queue.'
                  : 'Registered specimens will appear here with their status, priority and due time.'
              }
            />
            {filtered && (
              <div className="pb-6 text-center">
                <Button type="button" variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      {createOpen && (
        <CreateSampleDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(id) => {
            setCreateOpen(false);
            navigate(`/samples/${id}`);
          }}
        />
      )}
    </div>
  );
}
