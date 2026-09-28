import { useState, type FormEvent } from 'react';
import { ArrowRight, FlaskConical, Loader2, TestTube2 } from 'lucide-react';
import type { Session } from '@shared/types';
import { ApiError, useLogin, useRegister, useSetup } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function SignInPage({ session }: { session: Session }) {
  const setup = session.setupRequired && session.setupAllowed;
  const login = useLogin();
  const initialize = useSetup();
  const register = useRegister();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fields, setFields] = useState({
    name: '',
    email: '',
    password: '',
    workspaceName: '',
    timezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Johannesburg',
    role: 'patient' as 'patient' | 'clinician' | 'transporter',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const registering = !setup && mode === 'register';
  const pending = login.isPending || initialize.isPending || register.isPending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const values = {
      ...fields,
      name: fields.name.trim(),
      email: fields.email.trim(),
      workspaceName: fields.workspaceName.trim(),
      timezone: fields.timezone.trim(),
    };
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email))
      next.email = 'Enter a valid email address.';
    if (values.password.length < (setup || registering ? 12 : 1))
      next.password = setup
        ? 'Use at least 12 characters.'
        : registering
          ? 'Use at least 12 characters.'
          : 'Enter your password.';
    if (setup || registering) {
      if (!values.name) next.name = 'Enter your name.';
    }
    if (setup) {
      if (!values.workspaceName)
        next.workspaceName = 'Enter the laboratory or workspace name.';
      try {
        new Intl.DateTimeFormat('en', { timeZone: values.timezone }).format();
      } catch {
        next.timezone = 'Choose a valid timezone.';
      }
    }
    setErrors(next);
    setMessage('');
    if (Object.keys(next).length) return;
    try {
      if (setup)
        await initialize.mutateAsync({
          name: values.name,
          email: values.email,
          password: values.password,
          workspaceName: values.workspaceName,
          timezone: values.timezone,
        });
      else if (registering)
        await register.mutateAsync({
          name: values.name,
          email: values.email,
          password: values.password,
          role: values.role,
        });
      else
        await login.mutateAsync({
          email: values.email,
          password: values.password,
        });
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Sign-in could not be completed. Please try again.',
      );
      if (error instanceof ApiError) setErrors(error.fields ?? {});
    }
  }

  function field(
    name: keyof typeof fields,
    label: string,
    type = 'text',
    autocomplete?: string,
  ) {
    return (
      <div className="space-y-2">
        <Label htmlFor={`auth-${name}`}>{label}</Label>
        <Input
          id={`auth-${name}`}
          name={name}
          type={type}
          value={fields[name]}
          onChange={(event) =>
            setFields((current) => ({ ...current, [name]: event.target.value }))
          }
          disabled={pending}
          required
          maxLength={name === 'password' ? 128 : name === 'email' ? 254 : 160}
          autoComplete={autocomplete}
          aria-invalid={!!errors[name]}
          aria-describedby={errors[name] ? `auth-error-${name}` : undefined}
          className="h-11"
        />
        {errors[name] && (
          <p id={`auth-error-${name}`} className="text-sm text-destructive">
            {errors[name]}
          </p>
        )}
      </div>
    );
  }

  return (
    <main className="grid min-h-[100dvh] lg:grid-cols-[.9fr_1.1fr]">
      <div className="flex flex-col justify-between bg-sidebar px-6 py-8 text-sidebar-foreground lg:p-14">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <FlaskConical aria-hidden="true" />
          </div>
          <span className="text-xl font-bold text-white">LabLink</span>
        </div>
        <div className="my-10 max-w-lg lg:my-20">
          <p className="font-mono-ui text-xs uppercase tracking-[.18em] text-sidebar-primary">
            Laboratory operations
          </p>
          <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight text-white lg:text-5xl">
            Clarity at every handoff.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-sidebar-foreground">
            Track specimens, coordinate processing, and keep the verification
            queue moving with your team.
          </p>
        </div>
        <p className="hidden items-center gap-2 text-sm text-sidebar-foreground lg:flex">
          <TestTube2 size={18} aria-hidden="true" />
          One workspace for your specimen operations.
        </p>
      </div>
      <div className="flex items-center justify-center px-5 py-10 lg:p-14">
        <div className="w-full max-w-md">
          <h2 className="text-2xl font-bold tracking-tight">
            {setup
              ? 'Set up your workspace'
              : registering
                ? 'Create your portal account'
                : 'Welcome back'}
          </h2>
          <p className="mb-7 mt-2 text-sm leading-relaxed text-muted-foreground">
            {setup
              ? 'Create the first administrator account and choose your laboratory timezone.'
              : registering
                ? 'Choose the account that matches how you use the laboratory. Your laboratory must link requests to your account before they appear.'
                : 'Sign in with your laboratory account to continue.'}
          </p>
          {session.setupRequired && !session.setupAllowed ? (
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-sm">
                This workspace needs an administrator account. Ask the person
                managing this installation to complete its setup.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-5">
              {(setup || registering) &&
                field(
                  setup ? 'workspaceName' : 'name',
                  setup ? 'Workspace name' : 'Your name',
                  'text',
                  setup ? 'organization' : 'name',
                )}
              {setup && field('name', 'Your name', 'text', 'name')}
              {registering && (
                <div className="space-y-2">
                  <Label htmlFor="auth-role">I am registering as</Label>
                  <select
                    id="auth-role"
                    value={fields.role}
                    onChange={(event) =>
                      setFields((current) => ({
                        ...current,
                        role: event.target.value as typeof current.role,
                      }))
                    }
                    disabled={pending}
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="patient">Patient</option>
                    <option value="clinician">Clinician</option>
                    <option value="transporter">Transporter</option>
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Laboratory administrators create technician, reviewer and
                    administrator accounts.
                  </p>
                </div>
              )}
              {field('email', 'Email', 'email', 'username')}
              {field(
                'password',
                'Password',
                'password',
                setup || registering ? 'new-password' : 'current-password',
              )}
              {setup && (
                <>
                  <p className="-mt-2 text-xs text-muted-foreground">
                    Choose a password with at least 12 characters.
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="auth-timezone">Laboratory timezone</Label>
                    <Input
                      id="auth-timezone"
                      list="timezones"
                      value={fields.timezone}
                      onChange={(event) =>
                        setFields((current) => ({
                          ...current,
                          timezone: event.target.value,
                        }))
                      }
                      disabled={pending}
                      aria-invalid={!!errors.timezone}
                      aria-describedby="timezone-help"
                      required
                    />
                    <datalist id="timezones">
                      {[
                        ...new Set([
                          Intl.DateTimeFormat().resolvedOptions().timeZone,
                          'Africa/Johannesburg',
                          'UTC',
                          'Europe/London',
                          'America/New_York',
                          'Asia/Dubai',
                        ]),
                      ].map((zone) => (
                        <option key={zone} value={zone} />
                      ))}
                    </datalist>
                    <p
                      id="timezone-help"
                      className={`text-xs ${errors.timezone ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      {errors.timezone ??
                        'Used for daily totals and timestamps, for example Africa/Johannesburg.'}
                    </p>
                  </div>
                </>
              )}
              {message && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  {message}
                </p>
              )}
              <Button type="submit" className="h-11 w-full" disabled={pending}>
                {pending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowRight aria-hidden="true" />
                )}
                {setup
                  ? 'Create workspace'
                  : registering
                    ? 'Create account'
                    : 'Sign in'}
              </Button>
              {!setup && (
                <p className="text-center text-sm text-muted-foreground">
                  {registering
                    ? 'Already have an account? '
                    : 'Need an account? '}
                  <button
                    type="button"
                    className="font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    onClick={() => {
                      setMode(registering ? 'login' : 'register');
                      setErrors({});
                      setMessage('');
                    }}
                    disabled={pending}
                  >
                    {registering ? 'Sign in' : 'Create a portal account'}
                  </button>
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
