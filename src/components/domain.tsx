import type { ElementType, ReactNode } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ClipboardList,
  RefreshCw,
} from 'lucide-react';
import { Link } from 'wouter';
import type { Sample, SampleStatus } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Badge as PrimitiveBadge } from '@/components/ui/badge';
import { formatRelative, formatTime } from '@/lib/format';

export const statusTone: Record<SampleStatus, string> = {
  received: 'bg-sky-100 text-sky-900 border-sky-200',
  processing: 'bg-amber-100 text-amber-900 border-amber-200',
  verification: 'bg-violet-100 text-violet-900 border-violet-200',
  completed: 'bg-emerald-100 text-emerald-900 border-emerald-200',
  delayed: 'bg-rose-100 text-rose-900 border-rose-200',
  recollection: 'bg-orange-100 text-orange-900 border-orange-200',
};

export function Badge({
  children,
  tone = 'bg-secondary text-secondary-foreground',
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <PrimitiveBadge
      variant="outline"
      className={`rounded-md px-2 py-1 text-xs ${tone}`}
    >
      {children}
    </PrimitiveBadge>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        {eyebrow && (
          <p className="mb-1 font-mono-ui text-xs uppercase tracking-[.14em] text-primary">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading records"
      className="space-y-3"
      data-testid="loading-state"
    >
      <span className="sr-only">Loading records…</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="skeleton h-16 rounded-xl"
        />
      ))}
    </div>
  );
}

export function ErrorState({
  onRetry,
  error,
}: {
  onRetry: () => void;
  error?: unknown;
}) {
  return (
    <div
      className="rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center"
      data-testid="error-state"
    >
      <AlertCircle
        className="mx-auto mb-3 text-destructive"
        aria-hidden="true"
      />
      <h2 className="font-semibold">We could not load this view</h2>
      <p className="mt-2 text-sm text-muted-foreground" role="alert">
        {error instanceof Error
          ? error.message
          : 'The service could not be reached. Please try again.'}
      </p>
      <Button onClick={onRetry} variant="outline" className="mt-4">
        <RefreshCw size={14} />
        Try again
      </Button>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = ClipboardList,
}: {
  title: string;
  description: string;
  icon?: ElementType;
}) {
  return (
    <div
      className="grid place-items-center px-5 py-12 text-center"
      data-testid="empty-state"
    >
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-primary">
        <Icon size={22} aria-hidden="true" />
      </div>
      <h2 className="mt-4 font-semibold">{title}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

export function SampleRow({ sample }: { sample: Sample }) {
  const overdue =
    !['completed', 'recollection'].includes(sample.status) &&
    new Date(sample.dueAt).getTime() < Date.now();
  return (
    <Link
      href={`/samples/${sample.id}`}
      data-testid={`link-sample-${sample.id}`}
      className="group grid gap-3 px-5 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:grid-cols-[1.2fr_1fr_auto]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono-ui text-xs font-bold text-primary">
            {sample.sampleNumber}
          </span>
          {sample.hasAlert && (
            <span className="text-xs font-semibold text-destructive">
              Active alert
            </span>
          )}
        </div>
        <p className="mt-1 break-words font-semibold">{sample.patientName}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {sample.patientId} · {sample.facility}
        </p>
      </div>
      <div className="min-w-0">
        <p className="break-words text-sm">{sample.testName}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {sample.sampleType} · {sample.department}
        </p>
        <p
          className={`mt-2 text-xs ${overdue ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}
          title={formatTime(sample.dueAt)}
        >
          {sample.status === 'completed'
            ? `Completed ${formatRelative(sample.completedAt)}`
            : sample.status === 'recollection'
              ? 'Recollection requested'
              : `${overdue ? 'Overdue · target was' : 'Due'} ${formatRelative(sample.dueAt)}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        <Badge tone={statusTone[sample.status]}>{sample.statusLabel}</Badge>
        {sample.priority !== 'routine' && (
          <Badge
            tone={
              sample.priority === 'urgent'
                ? 'bg-rose-100 text-rose-900'
                : 'bg-amber-100 text-amber-900'
            }
          >
            {sample.priority} priority
          </Badge>
        )}
        <ArrowRight
          size={16}
          className="ml-auto text-primary sm:ml-1"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}
