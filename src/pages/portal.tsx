import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { ArrowRight, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useSamples, useSession } from '@/lib/api';
import { formatTime } from '@/lib/format';
import {
  Badge,
  EmptyState,
  ErrorState,
  LoadingState,
  SectionHeading,
  statusTone,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { fieldClass } from '@/features/samples/form-fields';

export default function PortalPage() {
  const session = useSession();
  const role = session.data?.user?.role;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [queryText, setQueryText] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQueryText(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const query = useSamples({ page, pageSize: 20, search: queryText });
  const pages = Math.max(1, Math.ceil((query.data?.total ?? 0) / 20));
  const transporter = role === 'transporter';
  const clinician = role === 'clinician';
  return (
    <div className="page-enter">
      <SectionHeading
        eyebrow={
          transporter
            ? 'Specimen logistics'
            : clinician
              ? 'Clinician portal'
              : 'Patient portal'
        }
        title={
          transporter
            ? 'Assigned specimens'
            : clinician
              ? 'Clinical requests'
              : 'My requests'
        }
        description={
          transporter
            ? 'Collection and delivery progress for the specimens assigned to you.'
            : clinician
              ? 'Review your assigned requests, acknowledge released results and manage patient access.'
              : 'Follow your requests and open results when they are available to you.'
        }
        action={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => query.refetch()}
          >
            <RefreshCw className={query.isFetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
        }
      />
      <div className="mb-5 max-w-lg">
        <label
          htmlFor="portal-search"
          className="mb-2 block text-xs font-semibold"
        >
          {transporter ? 'Search specimen numbers' : 'Search your requests'}
        </label>
        <input
          id="portal-search"
          type="search"
          maxLength={160}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={fieldClass}
        />
      </div>
      <section
        aria-label="Assigned requests"
        className="overflow-hidden rounded-xl border border-card-border bg-card panel-shadow"
      >
        {query.isLoading ? (
          <div className="p-5">
            <LoadingState />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data?.items.length ? (
          <>
            <div className="divide-y divide-border">
              {query.data.items.map((sample) => (
                <Link
                  key={sample.id}
                  href={`/samples/${sample.id}`}
                  className="flex items-center justify-between gap-4 p-5 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <div className="min-w-0">
                    <p className="font-mono-ui text-xs font-semibold text-primary">
                      {sample.sampleNumber}
                    </p>
                    <h2 className="mt-2 break-words font-semibold">
                      {transporter
                        ? sample.facility || 'Assigned specimen'
                        : clinician
                          ? sample.patientName
                          : sample.testName}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {transporter
                        ? sample.sampleType
                        : clinician
                          ? sample.testName
                          : sample.facility}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge tone={statusTone[sample.status]}>
                        {sample.statusLabel}
                      </Badge>
                      {sample.priority !== 'routine' && (
                        <Badge>{sample.priority} priority</Badge>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Updated{' '}
                      {formatTime(
                        sample.updatedAt,
                        session.data?.user?.timezone,
                      )}
                    </p>
                  </div>
                  <ArrowRight className="shrink-0 text-primary" size={18} />
                </Link>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border p-4">
              <p className="text-xs text-muted-foreground">
                {query.data.total} assigned requests
              </p>
              <nav
                aria-label="Request pages"
                className="flex items-center gap-3"
              >
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || query.isFetching}
                  aria-label="Previous page"
                  onClick={() => setPage((current) => current - 1)}
                >
                  <ChevronLeft />
                </Button>
                <span className="text-xs">
                  Page {page} of {pages}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= pages || query.isFetching}
                  aria-label="Next page"
                  onClick={() => setPage((current) => current + 1)}
                >
                  <ChevronRight />
                </Button>
              </nav>
            </div>
          </>
        ) : (
          <EmptyState
            title={queryText ? 'No matching requests' : 'No assigned requests'}
            description={
              queryText
                ? 'Try another specimen number or clear your search.'
                : 'Requests appear here when your laboratory links them to your account. Contact the laboratory if a request is missing.'
            }
          />
        )}
      </section>
    </div>
  );
}
