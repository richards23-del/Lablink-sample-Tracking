import { useState, type FormEvent } from 'react';
import { Bell, Check, Plus, UserRound, Users } from 'lucide-react';
import type { Preferences, Role } from '@shared/types';
import {
  Badge,
  EmptyState,
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  useCreateUser,
  ApiError,
  usePreferences,
  useSavePreferences,
  useSession,
  useUsers,
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { isStaff, roleDescriptions } from '@/lib/roles';

const preferenceOptions: {
  key: keyof Preferences;
  label: string;
  description: string;
}[] = [
  {
    key: 'urgent',
    label: 'Urgent sample events',
    description: 'Notifications when an urgent sample is registered.',
  },
  {
    key: 'delays',
    label: 'Delay and recollection events',
    description:
      'Notifications when a sample exceeds its turnaround target or needs recollection.',
  },
  {
    key: 'verification',
    label: 'Verification queue activity',
    description: 'Notifications when a result is ready for review or released.',
  },
];

export default function SettingsPage() {
  const session = useSession();
  const user = session.data?.user;
  if (!user) return null;

  return (
    <div className="page-enter">
      <SectionHeading
        eyebrow="Workspace controls"
        title="Settings"
        description="Manage your notification preferences and review your workspace access."
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-5">
          <section
            className="panel-shadow rounded-xl border border-card-border bg-card p-5"
            aria-labelledby="profile-heading"
          >
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                <UserRound size={18} aria-hidden="true" />
              </div>
              <div>
                <h2 id="profile-heading" className="font-semibold">
                  Your account
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Workspace access is managed by your laboratory administrator.
                </p>
              </div>
            </div>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                ['Name', user.name],
                ['Email', user.email],
                ['Role', user.role],
                ['Workspace', user.workspaceName],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="min-w-0 rounded-lg border border-border bg-muted/40 p-4"
                >
                  <dt className="font-mono-ui text-[10px] uppercase tracking-[.14em] text-muted-foreground">
                    {label}
                  </dt>
                  <dd
                    className={`mt-2 break-words text-sm font-semibold ${label === 'Role' ? 'capitalize' : ''}`}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          {isStaff(user.role) ? (
            <PreferencesSection />
          ) : (
            <section className="rounded-xl border border-card-border bg-card p-5">
              <h2 className="font-semibold">Request notifications</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Your inbox contains updates for requests linked to your account.
                Your laboratory records the contact details and selected email,
                SMS or WhatsApp channels for each request.
              </p>
            </section>
          )}
          {user.role === 'admin' && <TeamSection />}
        </div>
        <aside
          aria-label="Workspace details"
          className="h-fit rounded-xl border border-primary/15 bg-primary/[.045] p-5"
        >
          <h2 className="font-semibold">Workspace time</h2>
          <p className="mt-2 break-words text-sm text-muted-foreground">
            {user.timezone.replaceAll('_', ' ')}
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Dates in sample records and daily totals use the laboratory time
            zone.
          </p>
          <div className="mt-5 border-t border-primary/15 pt-5">
            <h2 className="text-sm font-semibold capitalize">
              {user.role} access
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {roleDescriptions[user.role]}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PreferencesSection() {
  const query = usePreferences();
  const save = useSavePreferences();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Preferences | null>(null);
  const [error, setError] = useState('');
  const preferences = draft ?? query.data;
  const dirty = Boolean(
    draft &&
    query.data &&
    preferenceOptions.some(({ key }) => draft[key] !== query.data[key]),
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!preferences || !dirty || save.isPending) return;
    setError('');
    try {
      await save.mutateAsync(preferences);
      setDraft(null);
      toast({
        title: 'Preferences saved',
        description: 'Your preferences apply to future in-app notifications.',
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save your preferences. Please try again.',
      );
    }
  }

  return (
    <section
      className="panel-shadow rounded-xl border border-card-border bg-card p-5"
      aria-labelledby="preferences-heading"
    >
      <div className="mb-5 flex items-start gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent/25 text-accent-foreground">
          <Bell size={18} aria-hidden="true" />
        </div>
        <div>
          <h2 id="preferences-heading" className="font-semibold">
            Notification preferences
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Choose which future laboratory events appear in your in-app inbox.
            External messages use the recipient channels recorded on each
            request. Operational alerts remain visible on the Alerts page.
          </p>
        </div>
      </div>
      {query.isLoading ? (
        <LoadingState rows={3} />
      ) : query.isError || !preferences ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <form onSubmit={submit}>
          <div className="divide-y divide-border">
            {preferenceOptions.map(({ key, label, description }) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4 py-4 first:pt-0"
              >
                <div>
                  <Label
                    htmlFor={`preference-${key}`}
                    className="text-sm font-semibold"
                  >
                    {label}
                  </Label>
                  <p
                    id={`preference-description-${key}`}
                    className="mt-1 text-xs text-muted-foreground"
                  >
                    {description}
                  </p>
                </div>
                <Switch
                  id={`preference-${key}`}
                  checked={preferences[key]}
                  aria-describedby={`preference-description-${key}`}
                  disabled={save.isPending}
                  onCheckedChange={(checked) => {
                    setDraft({ ...preferences, [key]: checked });
                    setError('');
                  }}
                />
              </div>
            ))}
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground" role="status">
              {save.isPending
                ? 'Saving preferences…'
                : dirty
                  ? 'You have unsaved changes.'
                  : 'Preferences match your saved settings.'}
            </p>
            <div className="flex gap-2">
              {dirty && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => {
                    setDraft(null);
                    setError('');
                  }}
                >
                  Reset
                </Button>
              )}
              <Button type="submit" disabled={!dirty || save.isPending}>
                <Check aria-hidden="true" />
                {save.isPending ? 'Saving…' : 'Save preferences'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

function TeamSection() {
  const query = useUsers();
  const create = useCreateUser();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'technician' as Role,
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function reset() {
    setForm({ name: '', email: '', password: '', role: 'technician' });
    setError('');
    setFieldErrors({});
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (create.isPending) return;
    setError('');
    setFieldErrors({});
    try {
      await create.mutateAsync({
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
      });
      setOpen(false);
      reset();
      toast({
        title: 'Team member created',
        description: 'The account can now sign in to this workspace.',
      });
    } catch (cause) {
      if (cause instanceof ApiError && cause.fields) {
        setFieldErrors(cause.fields);
        const firstField = Object.keys(cause.fields)[0];
        document.getElementById(`team-${firstField}`)?.focus();
      }
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not create this account. Please try again.',
      );
    }
  }

  return (
    <section
      className="panel-shadow rounded-xl border border-card-border bg-card p-5"
      aria-labelledby="team-heading"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
            <Users size={18} aria-hidden="true" />
          </div>
          <div>
            <h2 id="team-heading" className="font-semibold">
              Team access
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Create an individual account for each team member.
            </p>
          </div>
        </div>
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (!create.isPending) {
              setOpen(value);
              if (!value) reset();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus aria-hidden="true" />
              Add team member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add team member</DialogTitle>
              <DialogDescription>
                Create an account in this laboratory workspace and assign the
                access it needs.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="team-name">Full name</Label>
                <Input
                  id="team-name"
                  autoComplete="name"
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  required
                  minLength={1}
                  maxLength={160}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={
                    fieldErrors.name ? 'team-name-error' : undefined
                  }
                  className="mt-2"
                  disabled={create.isPending}
                />
                {fieldErrors.name && (
                  <p
                    id="team-name-error"
                    className="mt-1 text-xs text-destructive"
                  >
                    {fieldErrors.name}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="team-email">Email address</Label>
                <Input
                  id="team-email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  required
                  maxLength={254}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={
                    fieldErrors.email ? 'team-email-error' : undefined
                  }
                  className="mt-2"
                  disabled={create.isPending}
                />
                {fieldErrors.email && (
                  <p
                    id="team-email-error"
                    className="mt-1 text-xs text-destructive"
                  >
                    {fieldErrors.email}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="team-password">Password</Label>
                <Input
                  id="team-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                  required
                  minLength={12}
                  maxLength={128}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={`team-password-help${fieldErrors.password ? ' team-password-error' : ''}`}
                  className="mt-2"
                  disabled={create.isPending}
                />
                {fieldErrors.password && (
                  <p
                    id="team-password-error"
                    className="mt-1 text-xs text-destructive"
                  >
                    {fieldErrors.password}
                  </p>
                )}
                <p
                  id="team-password-help"
                  className="mt-1.5 text-xs text-muted-foreground"
                >
                  Use at least 12 characters and share the credentials privately
                  with this team member.
                </p>
              </div>
              <div>
                <Label htmlFor="team-role">Role</Label>
                <select
                  id="team-role"
                  value={form.role}
                  onChange={(event) =>
                    setForm({ ...form, role: event.target.value as Role })
                  }
                  disabled={create.isPending}
                  aria-invalid={Boolean(fieldErrors.role)}
                  aria-describedby={`team-role-help${fieldErrors.role ? ' team-role-error' : ''}`}
                  className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <option value="technician">Technician</option>
                  <option value="reviewer">Reviewer</option>
                  <option value="admin">Administrator</option>
                  <option value="clinician">Clinician</option>
                  <option value="patient">Patient</option>
                  <option value="transporter">Transporter</option>
                </select>
                {fieldErrors.role && (
                  <p
                    id="team-role-error"
                    className="mt-1 text-xs text-destructive"
                  >
                    {fieldErrors.role}
                  </p>
                )}
                <p
                  id="team-role-help"
                  className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
                >
                  {roleDescriptions[form.role]}
                </p>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                  disabled={create.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={create.isPending || !form.name.trim()}
                >
                  {create.isPending ? 'Creating account…' : 'Create account'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {query.isLoading ? (
        <LoadingState rows={2} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : query.data?.length ? (
        <ul className="divide-y divide-border">
          {query.data.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold">
                  {member.name}
                </div>
                <div className="mt-1 break-all text-xs text-muted-foreground">
                  {member.email}
                </div>
              </div>
              <Badge>{member.role}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No team accounts found"
          description="Create an account to give a team member access to the workspace."
          icon={Users}
        />
      )}
    </section>
  );
}
