import { QueryClient, useMutation, useQuery } from '@tanstack/react-query';
import type {
  Alert,
  ApiErrorBody,
  CreateSampleInput,
  DashboardSummary,
  Notification,
  PaginatedSamples,
  Preferences,
  RecollectionInput,
  Role,
  Sample,
  DirectoryUser,
  SampleDetail,
  SampleFilters,
  Session,
  TransitionInput,
  User,
} from '@shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public fields?: Record<string, string>,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const sessionKey = ['auth', 'session'] as const;
export const domainKey = ['lablink'] as const;
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (count, error) =>
        count < 2 && !(error instanceof ApiError && error.status < 500),
    },
    mutations: { retry: false },
  },
});

let csrfToken: string | null = null;
function apiRoot(): string {
  const match = window.location.pathname.match(
    /^\/w\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/,
  );
  return match ? `/w/${match[1]}/api` : '/api';
}
async function request<T>(
  path: string,
  options: RequestInit = {},
  refreshCsrf = true,
): Promise<T> {
  const method = options.method ?? 'GET';
  if (!['GET', 'HEAD'].includes(method) && !csrfToken) {
    const session = await request<Session>('/auth/session');
    csrfToken = session.csrfToken;
  }
  let response: Response;
  try {
    response = await fetch(`${apiRoot()}${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(!['GET', 'HEAD'].includes(method) && csrfToken
          ? { 'X-CSRF-Token': csrfToken }
          : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ApiError(
      'The service could not be reached. Check your connection and try again.',
      0,
    );
  }
  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json');
  const body =
    response.status === 204
      ? undefined
      : isJson
        ? await response.json()
        : undefined;
  if (!response.ok) {
    if (
      response.status === 403 &&
      body?.code === 'CSRF_REJECTED' &&
      refreshCsrf
    ) {
      const session = await request<Session>('/auth/session');
      csrfToken = session.csrfToken;
      queryClient.setQueryData(sessionKey, session);
      return request<T>(path, options, false);
    }
    if (response.status === 401 && !path.startsWith('/auth/')) {
      csrfToken = null;
      void queryClient.cancelQueries({ queryKey: domainKey });
      queryClient.removeQueries({ queryKey: domainKey });
      queryClient.setQueryData<Session>(sessionKey, (old) => ({
        setupRequired: old?.setupRequired ?? false,
        setupAllowed: old?.setupAllowed ?? false,
        user: null,
        csrfToken: null,
      }));
    }
    const error = body as ApiErrorBody | undefined;
    throw new ApiError(
      error?.message ??
        `The request failed (${response.status}). Please try again.`,
      response.status,
      error?.fields,
      error?.code,
    );
  }
  if (response.status !== 204 && !isJson)
    throw new ApiError('The service returned an unexpected response.', 502);
  return body as T;
}

export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async ({ signal }) => {
      const session = await request<Session>('/auth/session', { signal });
      csrfToken = session.csrfToken;
      if (
        !session.user &&
        queryClient.getQueryData<Session>(sessionKey)?.user
      ) {
        await queryClient.cancelQueries({ queryKey: domainKey });
        queryClient.removeQueries({ queryKey: domainKey });
      }
      return session;
    },
    retry: false,
    refetchInterval: 60_000,
  });
}

function useAuthenticate<T>(path: string) {
  return useMutation({
    mutationFn: (input: T) =>
      request<Session>(path, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: async (session) => {
      await queryClient.cancelQueries({ queryKey: domainKey });
      queryClient.removeQueries({ queryKey: domainKey });
      await queryClient.cancelQueries({ queryKey: sessionKey });
      csrfToken = session.csrfToken;
      queryClient.setQueryData(sessionKey, session);
    },
  });
}
export const useLogin = () =>
  useAuthenticate<{ email: string; password: string }>('/auth/login');
export const useSetup = () =>
  useAuthenticate<{
    name: string;
    email: string;
    password: string;
    workspaceName: string;
    timezone: string;
  }>('/auth/setup');
export const useRegister = () =>
  useAuthenticate<{
    name: string;
    email: string;
    password: string;
    role: 'patient' | 'clinician' | 'transporter';
  }>('/auth/register');
export function useCreateWorkspace() {
  return useMutation({
    mutationFn: (input: {
      name: string;
      email: string;
      password: string;
      workspaceName: string;
      timezone: string;
    }) =>
      request<{ workspace: { slug: string; name: string; url: string } }>(
        '/workspaces',
        { method: 'POST', body: JSON.stringify(input) },
      ),
  });
}
export function useLogout() {
  return useMutation({
    mutationFn: () => request<Session>('/auth/logout', { method: 'POST' }),
    onSuccess: async (session) => {
      await queryClient.cancelQueries({ queryKey: domainKey });
      queryClient.removeQueries({ queryKey: domainKey });
      await queryClient.cancelQueries({ queryKey: sessionKey });
      csrfToken = session.csrfToken;
      queryClient.setQueryData(sessionKey, session);
    },
  });
}

function useRead<T>(key: string, path: string, enabled = true) {
  return useQuery({
    queryKey: [...domainKey, key],
    queryFn: ({ signal }) => request<T>(path, { signal }),
    enabled,
    refetchInterval: 30_000,
  });
}

function useWrite<TInput, TResult>(
  path: (input: TInput) => string,
  body: (input: TInput) => unknown = (input) => input,
  method = 'POST',
) {
  return useMutation({
    mutationFn: (input: TInput) =>
      request<TResult>(path(input), {
        method,
        body: JSON.stringify(body(input) ?? {}),
      }),
    onSuccess: async (result) => {
      // Render server-issued IDs, authors, timestamps and versions immediately,
      // even if the subsequent refresh encounters a network failure.
      if (
        result &&
        typeof result === 'object' &&
        'sampleNumber' in result &&
        'timeline' in result &&
        'id' in result
      ) {
        queryClient.setQueryData([...domainKey, 'sample', result.id], result);
      }
      await queryClient.invalidateQueries({ queryKey: domainKey });
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.status === 409)
        await queryClient.invalidateQueries({ queryKey: domainKey });
    },
  });
}

export function useSamples(filters: SampleFilters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return useQuery({
    queryKey: [...domainKey, 'samples', filters],
    queryFn: ({ signal }) =>
      request<PaginatedSamples>(`/samples?${params}`, { signal }),
    refetchInterval: 30_000,
  });
}
export function useSample(id: number) {
  return useQuery({
    queryKey: [...domainKey, 'sample', id],
    queryFn: ({ signal }) =>
      request<SampleDetail>(`/samples/${id}`, { signal }),
    enabled: Number.isSafeInteger(id) && id > 0,
    refetchInterval: 30_000,
  });
}
export const useDashboard = () =>
  useRead<DashboardSummary>('dashboard', '/dashboard');
export const useAlerts = () => useRead<Alert[]>('alerts', '/alerts');
export const useNotifications = () =>
  useRead<Notification[]>('notifications', '/notifications');
export const usePreferences = () =>
  useRead<Preferences>('preferences', '/preferences');
export const useUsers = () => useRead<User[]>('users', '/users');
export const useDirectory = () =>
  useRead<DirectoryUser[]>('directory', '/directory');
export const useFollowups = () => useRead<Sample[]>('followups', '/followups');
export const usePatientAccess = () =>
  useWrite<{ id: number; version: number; allowed: boolean }, SampleDetail>(
    ({ id }) => `/samples/${id}/patient-access`,
    ({ id: _id, ...input }) => input,
  );
export const useAcknowledgeResults = () =>
  useWrite<{ id: number; version: number }, SampleDetail>(
    ({ id }) => `/samples/${id}/acknowledge-results`,
    ({ version }) => ({ version }),
  );
export const useRemindClinician = () =>
  useWrite<{ id: number; version: number }, SampleDetail>(
    ({ id }) => `/samples/${id}/remind-clinician`,
    ({ version }) => ({ version }),
  );

export interface IntegrationSettings {
  mode: 'standalone' | 'connected';
  keyConfigured: boolean;
  endpoint: string;
}
export const useIntegration = () =>
  useRead<IntegrationSettings>('integration', '/integration');
export const useSaveIntegration = () =>
  useWrite<{ mode: IntegrationSettings['mode'] }, IntegrationSettings>(
    () => '/integration',
    (input) => input,
    'PUT',
  );
export const useRotateIntegrationKey = () =>
  useMutation({
    gcTime: 0,
    mutationFn: (_input: Record<string, never>) =>
      request<{ key: string }>('/integration/key', {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: [...domainKey, 'integration'],
      });
    },
  });
export const useRevokeIntegrationKey = () =>
  useWrite<Record<string, never>, IntegrationSettings>(
    () => '/integration/key',
    (input) => input,
    'DELETE',
  );

export type OutboxStatus =
  | 'queued'
  | 'processing'
  | 'retry'
  | 'blocked'
  | 'failed'
  | 'preview'
  | 'accepted'
  | 'uncertain';
export interface OutboxMessage {
  id: number;
  sampleId: number;
  sampleNumber: string;
  event:
    | 'received'
    | 'rejected'
    | 'delayed'
    | 'results_available'
    | 'clinician_reminder';
  recipient: 'patient' | 'clinician' | 'transporter';
  channel: 'sms' | 'email' | 'whatsapp';
  destination: string;
  message: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  providerMessageId: string | null;
}
export interface CommunicationStatus {
  mode: 'preview' | 'live';
  providers: {
    sms: { configured: boolean };
    email: { configured: boolean };
    whatsapp: {
      configured: boolean;
      templates: { patient: boolean; clinician: boolean; transporter: boolean };
    };
  };
  counts: Record<OutboxStatus, number>;
}
export const useCommunications = () =>
  useRead<{ messages: OutboxMessage[]; status: CommunicationStatus }>(
    'communications',
    '/communications',
  );
export const useRetryCommunication = () =>
  useWrite<number, OutboxMessage>(
    (id) => `/communications/${id}/retry`,
    () => ({}),
  );
export const useCreateSample = () =>
  useWrite<CreateSampleInput, SampleDetail>(() => '/samples');
export const useTransitionSample = () =>
  useWrite<TransitionInput & { id: number }, SampleDetail>(
    (input) => `/samples/${input.id}/transition`,
    ({ id: _id, ...input }) => input,
  );
export const useAddNote = () =>
  useWrite<{ id: number; text: string }, SampleDetail>(
    (input) => `/samples/${input.id}/notes`,
    ({ text }) => ({ text }),
  );
export const useRecollectSample = () =>
  useWrite<RecollectionInput & { id: number }, SampleDetail>(
    (input) => `/samples/${input.id}/recollection`,
    ({ id: _id, ...input }) => input,
  );
export const useRegisterReplacement = () =>
  useWrite<{ id: number; version: number; collectedAt: string }, SampleDetail>(
    (input) => `/samples/${input.id}/replacement`,
    ({ id: _id, ...input }) => input,
  );
export const useAcknowledgeAlert = () =>
  useWrite<number, Alert>(
    (id) => `/alerts/${id}/acknowledge`,
    () => ({}),
  );
export const useResolveAlert = () =>
  useWrite<{ id: number; resolution: string }, Alert>(
    ({ id }) => `/alerts/${id}/resolve`,
    ({ resolution }) => ({ resolution }),
  );
export const useMarkNotificationRead = () =>
  useWrite<number, Notification>(
    (id) => `/notifications/${id}/read`,
    () => ({}),
  );
export const useSavePreferences = () =>
  useWrite<Preferences, Preferences>(
    () => '/preferences',
    (input) => input,
    'PUT',
  );
export const useCreateUser = () =>
  useWrite<{ name: string; email: string; password: string; role: Role }, User>(
    () => '/users',
  );

export async function syncWorkspace() {
  await queryClient.refetchQueries(
    { queryKey: domainKey, type: 'active' },
    { throwOnError: true },
  );
}
