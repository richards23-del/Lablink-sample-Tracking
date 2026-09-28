import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';

export const fieldClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-semibold">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  return message ? (
    <p
      role="alert"
      className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
    >
      {message}
    </p>
  ) : null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The request could not be completed. Please try again.';
}

export function errorFields(error: unknown): Record<string, string> {
  return error instanceof ApiError ? (error.fields ?? {}) : {};
}

export function collectionDateError(value: string): string | undefined {
  if (!value) return 'Enter the collection date and time.';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp))
    return 'Enter a valid collection date and time.';
  if (timestamp > Date.now()) return 'Collection time cannot be in the future.';
  return undefined;
}

export function boundedTextError(
  value: string,
  label: string,
  max: number,
): string | undefined {
  if (!value.trim()) return `Enter ${label.toLowerCase()}.`;
  if (value.trim().length > max) return `Use ${max} characters or fewer.`;
  return undefined;
}

export function focusFirstInvalid(form: HTMLFormElement) {
  window.requestAnimationFrame(() =>
    form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
  );
}

export function useDialogReturnFocus() {
  const [trigger] = useState(() =>
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  return (event: Event) => {
    if (trigger?.isConnected) {
      event.preventDefault();
      trigger.focus();
    }
  };
}
