import { useState, type FormEvent } from 'react';
import { Copy, KeyRound, Loader2, PlugZap } from 'lucide-react';
import {
  useIntegration,
  useRevokeIntegrationKey,
  useRotateIntegrationKey,
  useSaveIntegration,
  type IntegrationSettings,
} from '@/lib/api';
import {
  Badge,
  ErrorState,
  LoadingState,
  SectionHeading,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  errorMessage,
  fieldClass,
  FormError,
} from '@/features/samples/form-fields';

export default function IntegrationPage() {
  const query = useIntegration();
  const save = useSaveIntegration();
  const rotate = useRotateIntegrationKey();
  const revoke = useRevokeIntegrationKey();
  const [draft, setDraft] = useState<IntegrationSettings['mode'] | null>(null);
  const [key, setKey] = useState('');
  const [confirmation, setConfirmation] = useState<'rotate' | 'revoke' | null>(
    null,
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const mode = draft ?? query.data?.mode ?? 'standalone';
  const pending = save.isPending || rotate.isPending || revoke.isPending;

  async function saveMode(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      await save.mutateAsync({ mode });
      setDraft(null);
      setNotice('Workspace mode saved.');
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function changeKey(action: 'rotate' | 'revoke') {
    if (pending) return;
    setError('');
    setNotice('');
    try {
      if (action === 'rotate') {
        const result = await rotate.mutateAsync({});
        setKey(result.key);
        rotate.reset();
      } else {
        await revoke.mutateAsync({});
        setKey('');
        rotate.reset();
        setNotice('The integration key has been revoked.');
      }
      setConfirmation(null);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  async function copyKey() {
    try {
      await navigator.clipboard.writeText(key);
      setNotice(
        'Integration key copied. Store it in your integration service’s secret manager.',
      );
    } catch {
      setNotice(
        'Clipboard access is unavailable. Select and copy the key from the field.',
      );
    }
  }

  return (
    <div className="page-enter">
      <SectionHeading
        eyebrow="Administrator settings"
        title="System connection"
        description="Use LabLink as a specimen workspace or connect it to an existing laboratory information system."
      />
      <FormError message={error} />
      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-secondary p-3 text-sm">
          {notice}
        </p>
      )}
      {query.isLoading ? (
        <LoadingState />
      ) : query.isError || !query.data ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <section className="rounded-xl border border-card-border bg-card p-5 panel-shadow">
            <h2 className="font-semibold">Workspace mode</h2>
            <form onSubmit={saveMode} className="mt-4 space-y-4">
              <fieldset disabled={pending} className="space-y-3">
                <legend className="sr-only">Choose workspace mode</legend>
                {[
                  {
                    value: 'standalone',
                    title: 'Laboratory workspace',
                    description:
                      'Register specimens and manage processing, review, release and follow-up in LabLink.',
                  },
                  {
                    value: 'connected',
                    title: 'Connect an existing LIS',
                    description:
                      'Receive compatible specimen events from your existing laboratory information system. Your integration team configures the connection.',
                  },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer gap-3 rounded-lg border p-4 ${mode === option.value ? 'border-primary bg-primary/5' : 'border-border'}`}
                  >
                    <input
                      type="radio"
                      name="integration-mode"
                      value={option.value}
                      checked={mode === option.value}
                      onChange={() => {
                        setDraft(option.value as IntegrationSettings['mode']);
                        setNotice('');
                      }}
                      className="mt-1 h-4 w-4 accent-primary"
                    />
                    <span>
                      <span className="block text-sm font-semibold">
                        {option.title}
                      </span>
                      <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <Button
                type="submit"
                disabled={pending || mode === query.data.mode}
              >
                {save.isPending && <Loader2 className="animate-spin" />}Save
                workspace mode
              </Button>
            </form>
            <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
              Changing the mode does not import records or configure your LIS.
              This workspace manages specimen workflows, contacts and
              communication; inventory and instrument management remain with
              your laboratory systems.
            </p>
          </section>
          <section className="rounded-xl border border-card-border bg-card p-5 panel-shadow">
            <div className="flex items-center gap-2">
              <PlugZap size={18} className="text-primary" />
              <h2 className="font-semibold">Connection credentials</h2>
            </div>
            <div className="mt-4">
              <Badge>
                {query.data.keyConfigured
                  ? 'Key configured'
                  : 'No key configured'}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Incoming events endpoint
            </p>
            <code className="mt-2 block break-all rounded bg-muted p-3 text-xs">
              {query.data.endpoint}
            </code>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Give the integration key only to the service that connects your
              LIS. Keys are shown once and are never saved in this browser.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  query.data?.keyConfigured
                    ? setConfirmation('rotate')
                    : void changeKey('rotate')
                }
              >
                <KeyRound />
                {query.data.keyConfigured
                  ? 'Replace integration key'
                  : 'Create integration key'}
              </Button>
              {query.data.keyConfigured && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setConfirmation('revoke')}
                >
                  Revoke key
                </Button>
              )}
            </div>
          </section>
        </div>
      )}
      {key && (
        <section
          aria-labelledby="new-key-heading"
          className="mt-5 rounded-xl border border-primary/30 bg-card p-5"
        >
          <h2 id="new-key-heading" className="font-semibold">
            Copy your new integration key
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This is the only time the key will be shown. Store it securely
            before closing this panel.
          </p>
          <label htmlFor="integration-new-key" className="sr-only">
            New integration key
          </label>
          <textarea
            id="integration-new-key"
            readOnly
            value={key}
            rows={2}
            autoComplete="off"
            spellCheck={false}
            className={`${fieldClass} mt-4 font-mono`}
          />
          <div className="mt-3 flex gap-2">
            <Button type="button" onClick={copyKey}>
              <Copy />
              Copy key
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setKey('');
                rotate.reset();
              }}
            >
              I have stored the key
            </Button>
          </div>
        </section>
      )}
      <Dialog
        open={!!confirmation}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmation === 'revoke'
                ? 'Revoke integration key'
                : 'Replace integration key'}
            </DialogTitle>
            <DialogDescription>
              The current key will stop working immediately. Update the
              connecting service before it can send any more events.
            </DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => confirmation && void changeKey(confirmation)}
            >
              {pending && <Loader2 className="animate-spin" />}
              {confirmation === 'revoke' ? 'Revoke key' : 'Replace key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
