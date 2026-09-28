import { useState, type FormEvent } from 'react';
import { Loader2 } from 'lucide-react';
import type { SampleDetail } from '@shared/types';
import {
  useRecollectSample,
  useRegisterReplacement,
  useSession,
  useTransitionSample,
} from '@/lib/api';
import { formatTime, toDateTimeLocal } from '@/lib/format';
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
  boundedTextError,
  collectionDateError,
  errorFields,
  errorMessage,
  Field,
  fieldClass,
  focusFirstInvalid,
  FormError,
  useDialogReturnFocus,
} from './form-fields';

export type WorkflowMode =
  'verification' | 'release' | 'recollection' | 'replacement';
const titles: Record<WorkflowMode, string> = {
  verification: 'Submit for verification',
  release: 'Review and release result',
  recollection: 'Request recollection',
  replacement: 'Register replacement specimen',
};
const descriptions: Record<WorkflowMode, string> = {
  verification:
    'Record the result summary and confirm the required laboratory quality checks before review.',
  release:
    'Review the recorded result, patient details and quality confirmation before authorizing release.',
  recollection:
    'Record why a new specimen is required and provide collection instructions. The original specimen will remain in its audit history.',
  replacement:
    'Register the newly collected specimen. The original record and its recollection reason will remain linked to the replacement.',
};

export default function WorkflowDialog({
  mode,
  sample,
  onClose,
  onReplacement,
}: {
  mode: WorkflowMode;
  sample: SampleDetail;
  onClose: () => void;
  onReplacement: (id: number) => void;
}) {
  const transition = useTransitionSample();
  const recollect = useRecollectSample();
  const replace = useRegisterReplacement();
  const session = useSession();
  const returnFocus = useDialogReturnFocus();
  const [summary, setSummary] = useState(sample.resultSummary ?? '');
  const [qualityChecked, setQualityChecked] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState('');
  const [instructions, setInstructions] = useState('');
  const [collectedAt, setCollectedAt] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const pending =
    transition.isPending || recollect.isPending || replace.isPending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const nextFields: Record<string, string> = {};
    if (mode === 'verification') {
      const summaryError = boundedTextError(summary, 'Result summary', 2000);
      if (summaryError) nextFields.resultSummary = summaryError;
      if (!qualityChecked)
        nextFields.qualityChecked =
          'Confirm that the required quality checks are complete.';
    }
    if (mode === 'release' && !confirmed)
      nextFields.releaseConfirmed =
        'Confirm your review before releasing the result.';
    if (mode === 'recollection') {
      const reasonError = boundedTextError(reason, 'Recollection reason', 2000);
      const instructionsError = boundedTextError(
        instructions,
        'Collection instructions',
        2000,
      );
      if (reasonError) nextFields.reason = reasonError;
      if (instructionsError) nextFields.instructions = instructionsError;
    }
    if (mode === 'replacement') {
      const dateError = collectionDateError(collectedAt);
      if (dateError) nextFields.collectedAt = dateError;
      else if (
        new Date(collectedAt).getTime() < new Date(sample.collectedAt).getTime()
      ) {
        nextFields.collectedAt =
          'The new collection cannot precede the original collection.';
      }
    }
    setFields(nextFields);
    setMessage('');
    if (Object.keys(nextFields).length) {
      focusFirstInvalid(form);
      return;
    }
    try {
      if (mode === 'verification') {
        await transition.mutateAsync({
          id: sample.id,
          version: sample.version,
          action: 'submit_verification',
          resultSummary: summary.trim(),
          qualityChecked,
        });
      } else if (mode === 'release') {
        await transition.mutateAsync({
          id: sample.id,
          version: sample.version,
          action: 'release',
          releaseConfirmed: confirmed,
        });
      } else if (mode === 'recollection') {
        await recollect.mutateAsync({
          id: sample.id,
          version: sample.version,
          reason: reason.trim(),
          instructions: instructions.trim(),
        });
      } else {
        const replacement = await replace.mutateAsync({
          id: sample.id,
          version: sample.version,
          collectedAt: new Date(collectedAt).toISOString(),
        });
        onReplacement(replacement.id);
        return;
      }
      onClose();
    } catch (error) {
      setMessage(errorMessage(error));
      setFields(errorFields(error));
      focusFirstInvalid(form);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-w-xl"
        onCloseAutoFocus={returnFocus}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{titles[mode]}</DialogTitle>
          <DialogDescription>{descriptions[mode]}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg bg-muted/60 p-3 text-sm">
          <p className="font-semibold">
            {sample.patientName} · {sample.patientId}
          </p>
          <p className="mt-1 text-muted-foreground">
            {sample.sampleNumber} · {sample.testName} · {sample.sampleType}
          </p>
        </div>
        <form
          onSubmit={submit}
          noValidate
          className="space-y-5"
          aria-busy={pending}
        >
          <FormError message={message} />
          <fieldset disabled={pending} className="space-y-4">
            {mode === 'verification' && (
              <>
                <Field
                  id="verification-summary"
                  label="Result summary"
                  error={fields.resultSummary}
                  hint="Include the values, units and context needed by the reviewer, according to your laboratory procedure."
                >
                  <textarea
                    id="verification-summary"
                    required
                    rows={5}
                    maxLength={2000}
                    value={summary}
                    onChange={(event) => {
                      setSummary(event.target.value);
                      setFields((current) => ({
                        ...current,
                        resultSummary: '',
                      }));
                    }}
                    className={fieldClass}
                    aria-invalid={!!fields.resultSummary}
                    aria-describedby={`verification-summary-hint${fields.resultSummary ? ' verification-summary-error' : ''}`}
                  />
                </Field>
                <Field
                  id="verification-quality"
                  label="Quality checks"
                  error={fields.qualityChecked}
                >
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      id="verification-quality"
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-primary"
                      checked={qualityChecked}
                      onChange={(event) => {
                        setQualityChecked(event.target.checked);
                        setFields((current) => ({
                          ...current,
                          qualityChecked: '',
                        }));
                      }}
                      aria-invalid={!!fields.qualityChecked}
                      aria-describedby={
                        fields.qualityChecked
                          ? 'verification-quality-error'
                          : undefined
                      }
                    />
                    <span>
                      I confirm that the required quality checks are complete
                      and satisfactory for this specimen.
                    </span>
                  </label>
                </Field>
              </>
            )}
            {mode === 'release' && (
              <>
                <div className="space-y-3 rounded-lg border border-border p-4 text-sm">
                  <div>
                    <h3 className="font-semibold">
                      Result submitted for review
                    </h3>
                    <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground">
                      {sample.resultSummary || 'No result summary recorded.'}
                    </p>
                  </div>
                  <p>
                    <span className="text-muted-foreground">Entered by: </span>
                    {sample.resultEnteredBy || 'Not recorded'}
                  </p>
                  <p>
                    <span className="text-muted-foreground">
                      Quality checks:{' '}
                    </span>
                    {sample.qualityChecked ? 'Confirmed' : 'Not confirmed'}
                  </p>
                  <p>
                    <span className="text-muted-foreground">Collected: </span>
                    {formatTime(
                      sample.collectedAt,
                      session.data?.user?.timezone,
                    )}
                  </p>
                </div>
                <Field
                  id="release-confirmation"
                  label="Release authorization"
                  error={fields.releaseConfirmed}
                >
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      id="release-confirmation"
                      type="checkbox"
                      checked={confirmed}
                      className="mt-1 h-4 w-4 accent-primary"
                      onChange={(event) => {
                        setConfirmed(event.target.checked);
                        setFields((current) => ({
                          ...current,
                          releaseConfirmed: '',
                        }));
                      }}
                      aria-invalid={!!fields.releaseConfirmed}
                      aria-describedby={
                        fields.releaseConfirmed
                          ? 'release-confirmation-error'
                          : undefined
                      }
                    />
                    <span>
                      I have reviewed the patient, specimen, result and quality
                      confirmation, and authorize this release.
                    </span>
                  </label>
                </Field>
                <p className="text-xs text-muted-foreground">
                  Releasing completes this specimen. Your identity and release
                  time will be recorded.
                </p>
              </>
            )}
            {mode === 'recollection' && (
              <>
                <Field
                  id="recollection-reason"
                  label="Recollection reason"
                  error={fields.reason}
                >
                  <textarea
                    id="recollection-reason"
                    required
                    rows={3}
                    maxLength={2000}
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value);
                      setFields((current) => ({ ...current, reason: '' }));
                    }}
                    className={fieldClass}
                    aria-invalid={!!fields.reason}
                    aria-describedby={
                      fields.reason ? 'recollection-reason-error' : undefined
                    }
                  />
                </Field>
                <Field
                  id="recollection-instructions"
                  label="Collection instructions"
                  error={fields.instructions}
                >
                  <textarea
                    id="recollection-instructions"
                    required
                    rows={3}
                    maxLength={2000}
                    value={instructions}
                    onChange={(event) => {
                      setInstructions(event.target.value);
                      setFields((current) => ({
                        ...current,
                        instructions: '',
                      }));
                    }}
                    className={fieldClass}
                    aria-invalid={!!fields.instructions}
                    aria-describedby={
                      fields.instructions
                        ? 'recollection-instructions-error'
                        : undefined
                    }
                  />
                </Field>
              </>
            )}
            {mode === 'replacement' && (
              <>
                <div className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-semibold">Collection instructions</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                    {sample.recollectionInstructions ||
                      'No instructions recorded.'}
                  </p>
                </div>
                <Field
                  id="replacement-collectedAt"
                  label="New specimen collected at"
                  hint="Enter the new collection time in this device’s local time zone."
                  error={fields.collectedAt}
                >
                  <input
                    id="replacement-collectedAt"
                    type="datetime-local"
                    required
                    min={toDateTimeLocal(sample.collectedAt)}
                    max={toDateTimeLocal(new Date().toISOString())}
                    value={collectedAt}
                    onChange={(event) => {
                      setCollectedAt(event.target.value);
                      setFields((current) => ({ ...current, collectedAt: '' }));
                    }}
                    className={fieldClass}
                    aria-invalid={!!fields.collectedAt}
                    aria-describedby={`replacement-collectedAt-hint${fields.collectedAt ? ' replacement-collectedAt-error' : ''}`}
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  The replacement keeps this patient, requested test, referring
                  facility, department and priority. It receives its own sample
                  number and custody record.
                </p>
              </>
            )}
          </fieldset>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant={mode === 'recollection' ? 'destructive' : 'default'}
              disabled={
                pending ||
                (mode === 'release' &&
                  (!sample.resultSummary || !sample.qualityChecked))
              }
            >
              {pending && <Loader2 className="animate-spin" />}
              {mode === 'verification'
                ? 'Submit for verification'
                : mode === 'release'
                  ? 'Release result'
                  : mode === 'recollection'
                    ? 'Request recollection'
                    : 'Register replacement'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
