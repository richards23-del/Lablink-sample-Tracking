import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from 'express';
import helmet from 'helmet';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Session, User } from '../shared/types.js';
import {
  addUser,
  getUser,
  hashPassword,
  openDatabase,
  verifyPassword,
} from './database.js';
import { ApiError } from './errors.js';
import {
  SampleService,
  isStaff,
  type EnqueueCommunication,
} from './samples.js';
import {
  installIntegrationIngress,
  installIntegrationManagement,
} from './integration.js';
import {
  CommunicationsService,
  communicationsOptionsFromEnv,
  type CommunicationsOptions,
} from './communications.js';
import {
  filtersSchema,
  loginSchema,
  noteSchema,
  portalRegistrationSchema,
  patientAccessSchema,
  portalActionSchema,
  preferencesSchema,
  recollectionSchema,
  replacementSchema,
  resolutionSchema,
  sampleSchema,
  setupSchema,
  transitionSchema,
  userSchema,
} from './validation.js';
import type { ProvisionedWorkspace, WorkspaceInput } from './workspaces.js';

const COOKIE_NAME = 'lablink_session';
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;
const PREAUTH_DURATION_MS = 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOCAL_SETUP_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
]);

export interface AppOptions {
  databasePath: string;
  production?: boolean;
  allowedOrigins?: string[];
  staticDirectory?: string;
  now?: () => Date;
  turnaroundHours?: { routine: number; high: number; urgent: number };
  loginMaxAttempts?: number;
  enqueueCommunication?: EnqueueCommunication;
  communications?: CommunicationsOptions;
  /** Keeps browser sessions isolated when this application is mounted per lab. */
  cookiePath?: string;
  workspaceProvisioner?: {
    provision: (input: WorkspaceInput) => ProvisionedWorkspace;
  };
}

type SessionRow = {
  token_hash: string;
  user_id: number | null;
  csrf_token: string;
  expires_at: number;
};
type AuthContext = { session: SessionRow | null; user: User | null };

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sessionCookie(request: Request): string | undefined {
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  const value = cookie?.slice(COOKIE_NAME.length + 1);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

function safeEqual(first: string, second: string): boolean {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);
  return (
    firstBuffer.length === secondBuffer.length &&
    timingSafeEqual(firstBuffer, secondBuffer)
  );
}

function resourceId(value: unknown): number {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new ApiError(400, 'Use a valid positive resource ID.', 'INVALID_ID');
  return Number(value);
}

function loopback(request: Request): boolean {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
    request.socket.remoteAddress ?? '',
  );
}

/** A reverse proxy can make an internet request look loopback to Express. */
function localSetupRequest(request: Request): boolean {
  const origin = request.get('origin');
  return loopback(request) && (!origin || LOCAL_SETUP_ORIGINS.has(origin));
}

export function createApp(options: AppOptions) {
  const now = options.now ?? (() => new Date());
  const production =
    options.production ?? process.env.NODE_ENV === 'production';
  const cookiePath = options.cookiePath ?? '/';
  if (!/^\/(?:[a-z0-9-]+\/)*[a-z0-9-]*$/.test(cookiePath))
    throw new Error('Cookie path must be an absolute application path.');
  const allowedOrigins = new Set(
    options.allowedOrigins ?? [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3001',
      'http://127.0.0.1:3001',
    ],
  );
  const turnaroundHours = options.turnaroundHours ?? {
    routine: 24,
    high: 8,
    urgent: 2,
  };
  for (const hours of Object.values(turnaroundHours))
    if (!Number.isFinite(hours) || hours <= 0 || hours > 8760)
      throw new Error(
        'Turnaround targets must be positive hours, at most 8760.',
      );
  const database = openDatabase(options.databasePath);
  const communications = new CommunicationsService(database, {
    ...communicationsOptionsFromEnv(),
    ...options.communications,
    now,
  });
  const samples = new SampleService(
    database,
    now,
    turnaroundHours,
    (id, event, dedupeKey) => {
      communications.enqueue(id, event, dedupeKey);
      options.enqueueCommunication?.(id, event, dedupeKey);
    },
  );
  const dummyPassword = hashPassword(randomBytes(32).toString('hex'));
  const loginAttempts = new Map<string, { count: number; expiresAt: number }>();
  const registrationAttempts = new Map<
    string,
    { count: number; expiresAt: number }
  >();
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      // Vite injects its own development scripts. The built application has no inline scripts.
      contentSecurityPolicy: production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", 'data:'],
              fontSrc: ["'self'", 'data:'],
              connectSrc: ["'self'"],
              objectSrc: ["'none'"],
              frameAncestors: ["'none'"],
              upgradeInsecureRequests: null,
            },
          }
        : false,
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.use('/api', (_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', express.json({ limit: '32kb', strict: true }));
  installIntegrationIngress(app, database, samples, now);

  const authContext = (response: Response): AuthContext =>
    response.locals.auth as AuthContext;
  const authenticatedUser = (response: Response): User =>
    authContext(response).user!;
  const setupRequired = (): boolean =>
    !database.prepare('SELECT 1 FROM users LIMIT 1').get();

  function createSession(
    response: Response,
    user: User | null,
    previous: SessionRow | null,
  ): SessionRow {
    const token = randomBytes(32).toString('hex');
    const row: SessionRow = {
      token_hash: tokenHash(token),
      user_id: user?.id ?? null,
      csrf_token: randomBytes(32).toString('hex'),
      expires_at:
        now().getTime() + (user ? SESSION_DURATION_MS : PREAUTH_DURATION_MS),
    };
    database.transaction(() => {
      database
        .prepare('DELETE FROM sessions WHERE expires_at <= ?')
        .run(now().getTime());
      if (previous)
        database
          .prepare('DELETE FROM sessions WHERE token_hash = ?')
          .run(previous.token_hash);
      database
        .prepare(
          'INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)',
        )
        .run(row.token_hash, row.user_id, row.csrf_token, row.expires_at);
    })();
    response.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: production,
      path: cookiePath,
      maxAge: user ? SESSION_DURATION_MS : PREAUTH_DURATION_MS,
    });
    response.locals.auth = { user, session: row } satisfies AuthContext;
    return row;
  }

  function sessionResponse(request: Request, response: Response): Session {
    const auth = authContext(response);
    return {
      user: auth.user,
      csrfToken: auth.session?.csrf_token ?? null,
      setupRequired: setupRequired(),
      setupAllowed: !production && localSetupRequest(request),
    };
  }

  app.use('/api', (request, response, next) => {
    const token = sessionCookie(request);
    const row = token
      ? (database
          .prepare(
            'SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ?',
          )
          .get(tokenHash(token), now().getTime()) as SessionRow | undefined)
      : undefined;
    response.locals.auth = {
      session: row ?? null,
      user: row?.user_id ? (getUser(database, row.user_id) ?? null) : null,
    } satisfies AuthContext;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.get('origin');
      if (
        (origin && !allowedOrigins.has(origin)) ||
        request.get('sec-fetch-site') === 'cross-site'
      )
        return next(
          new ApiError(
            403,
            'This request origin is not allowed.',
            'ORIGIN_REJECTED',
          ),
        );
      const csrf = request.get('x-csrf-token');
      if (!row || !csrf || !safeEqual(csrf, row.csrf_token))
        return next(
          new ApiError(
            403,
            'Your session token expired. Refresh the page and try again.',
            'CSRF_REJECTED',
          ),
        );
    }
    next();
  });

  app.get('/api/auth/session', (request, response) => {
    if (!authContext(response).session) createSession(response, null, null);
    response.json(sessionResponse(request, response));
  });

  app.post('/api/auth/setup', (request, response) => {
    if (production || !localSetupRequest(request))
      throw new ApiError(
        403,
        'Browser setup is available only on the local development server. Ask the administrator to provision an account.',
        'SETUP_DISABLED',
      );
    const input = setupSchema.parse(request.body);
    const timestamp = now().toISOString();
    const user = database.transaction(() => {
      if (!setupRequired())
        throw new ApiError(
          409,
          'This workspace already has an administrator.',
          'SETUP_COMPLETE',
        );
      database
        .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run('workspace_name', input.workspaceName);
      database
        .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
        .run('timezone', input.timezone);
      const user = addUser(database, { ...input, role: 'admin' }, timestamp);
      database
        .prepare(
          'INSERT INTO security_audit (actor_id, action, subject_id, timestamp) VALUES (?, ?, ?, ?)',
        )
        .run(user.id, 'local_workspace_setup', user.id, timestamp);
      return user;
    })();
    createSession(response, user, authContext(response).session);
    response.status(201).json(sessionResponse(request, response));
  });

  function loginKeys(request: Request, email: string): string[] {
    return [
      `ip:${request.socket.remoteAddress ?? 'unknown'}`,
      `email:${email}`,
    ];
  }

  function rateLimitLogin(request: Request, email: string): void {
    const timestamp = now().getTime();
    for (const [key, value] of loginAttempts)
      if (value.expiresAt <= timestamp) loginAttempts.delete(key);
    const max = options.loginMaxAttempts ?? 10;
    const keys = loginKeys(request, email);
    if (keys.some((key) => (loginAttempts.get(key)?.count ?? 0) >= max))
      throw new ApiError(
        429,
        'Too many sign-in attempts. Try again in 15 minutes.',
        'RATE_LIMITED',
      );
    if (loginAttempts.size > 10_000)
      throw new ApiError(
        429,
        'Sign-in is temporarily busy. Try again later.',
        'RATE_LIMITED',
      );
  }

  function recordFailedLogin(request: Request, email: string): void {
    for (const key of loginKeys(request, email)) {
      const existing = loginAttempts.get(key);
      loginAttempts.set(key, {
        count: (existing?.count ?? 0) + 1,
        expiresAt: existing?.expiresAt ?? now().getTime() + LOGIN_WINDOW_MS,
      });
    }
  }

  function rateLimitRegistration(request: Request): void {
    const timestamp = now().getTime();
    for (const [key, value] of registrationAttempts)
      if (value.expiresAt <= timestamp) registrationAttempts.delete(key);
    const key = request.socket.remoteAddress ?? 'unknown';
    const current = registrationAttempts.get(key);
    if ((current?.count ?? 0) >= 5)
      throw new ApiError(
        429,
        'Too many account creation attempts. Try again in 15 minutes.',
        'RATE_LIMITED',
      );
    if (!current && registrationAttempts.size >= 10_000)
      throw new ApiError(
        429,
        'Account creation is temporarily busy. Try again later.',
        'RATE_LIMITED',
      );
    registrationAttempts.set(key, {
      count: (current?.count ?? 0) + 1,
      expiresAt: current?.expiresAt ?? timestamp + LOGIN_WINDOW_MS,
    });
  }

  app.post('/api/auth/login', (request, response) => {
    const input = loginSchema.parse(request.body);
    rateLimitLogin(request, input.email);
    const record = database
      .prepare('SELECT id, password_hash FROM users WHERE email = ?')
      .get(input.email) as { id: number; password_hash: string } | undefined;
    const matches = verifyPassword(
      input.password,
      record?.password_hash ?? dummyPassword,
    );
    if (!record || !matches) {
      recordFailedLogin(request, input.email);
      throw new ApiError(
        401,
        'Email or password is incorrect.',
        'INVALID_CREDENTIALS',
      );
    }
    const user = getUser(database, record.id)!;
    loginAttempts.delete(`email:${input.email}`);
    createSession(response, user, authContext(response).session);
    database
      .prepare(
        'INSERT INTO security_audit (actor_id, action, subject_id, timestamp) VALUES (?, ?, ?, ?)',
      )
      .run(user.id, 'login', user.id, now().toISOString());
    response.json(sessionResponse(request, response));
  });

  app.post('/api/auth/register', (request, response) => {
    if (setupRequired())
      throw new ApiError(
        409,
        'The laboratory must create its first administrator account before portal users can register.',
        'SETUP_REQUIRED',
      );
    rateLimitRegistration(request);
    const input = portalRegistrationSchema.parse(request.body);
    const timestamp = now().toISOString();
    const user = database.transaction(() => {
      if (
        database.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email)
      )
        throw new ApiError(
          409,
          'An account with that email already exists. Sign in instead.',
          'EMAIL_EXISTS',
        );
      const user = addUser(database, input, timestamp);
      database
        .prepare(
          'INSERT INTO security_audit (actor_id, action, subject_id, timestamp) VALUES (?, ?, ?, ?)',
        )
        .run(
          user.id,
          `portal_self_registered:${user.role}`,
          user.id,
          timestamp,
        );
      return user;
    })();
    createSession(response, user, authContext(response).session);
    response.status(201).json(sessionResponse(request, response));
  });

  app.post('/api/workspaces', (request, response) => {
    if (!options.workspaceProvisioner)
      throw new ApiError(
        404,
        'Lab-space creation is not enabled here.',
        'NOT_FOUND',
      );
    rateLimitRegistration(request);
    const workspace = options.workspaceProvisioner.provision(
      setupSchema.parse(request.body),
    );
    response.status(201).json({ workspace });
  });

  app.post('/api/auth/logout', (request, response) => {
    const auth = authContext(response);
    if (auth.session)
      database
        .prepare('DELETE FROM sessions WHERE token_hash = ?')
        .run(auth.session.token_hash);
    if (auth.user)
      database
        .prepare(
          'INSERT INTO security_audit (actor_id, action, subject_id, timestamp) VALUES (?, ?, ?, ?)',
        )
        .run(auth.user.id, 'logout', auth.user.id, now().toISOString());
    createSession(response, null, null);
    response.json(sessionResponse(request, response));
  });

  app.use('/api', (_request, response, next) => {
    if (!authenticatedUser(response))
      return next(new ApiError(401, 'Sign in to continue.', 'UNAUTHENTICATED'));
    next();
  });

  const requireAdmin = (response: Response): User => {
    const user = authenticatedUser(response);
    if (user.role !== 'admin')
      throw new ApiError(403, 'Administrator access is required.', 'FORBIDDEN');
    return user;
  };
  const requireStaff = (response: Response): User => {
    const user = authenticatedUser(response);
    if (!isStaff(user))
      throw new ApiError(
        403,
        'Laboratory staff access is required.',
        'FORBIDDEN',
      );
    return user;
  };
  installIntegrationManagement(app, database, requireAdmin, now);
  app.get('/api/directory', (_request, response) => {
    requireStaff(response);
    response.json(
      database
        .prepare('SELECT id, name, email, role FROM users ORDER BY name, id')
        .all(),
    );
  });
  app.get('/api/communications', (_request, response) => {
    requireAdmin(response);
    response.json({
      messages: communications.list(),
      status: communications.status(),
    });
  });
  app.post('/api/communications/:id/retry', (request, response) => {
    requireAdmin(response);
    response.json(communications.retry(resourceId(request.params.id)));
  });

  app.get('/api/users', (_request, response) => {
    requireAdmin(response);
    const ids = database.prepare('SELECT id FROM users ORDER BY id').all() as {
      id: number;
    }[];
    response.json(ids.map(({ id }) => getUser(database, id)));
  });
  app.post('/api/users', (request, response) => {
    const admin = requireAdmin(response);
    const input = userSchema.parse(request.body);
    const user = database.transaction(() => {
      if (
        database.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email)
      )
        throw new ApiError(
          409,
          'An account with that email already exists.',
          'EMAIL_EXISTS',
        );
      const timestamp = now().toISOString();
      const user = addUser(database, input, timestamp);
      database
        .prepare(
          'INSERT INTO security_audit (actor_id, action, subject_id, timestamp) VALUES (?, ?, ?, ?)',
        )
        .run(admin.id, 'user_created', user.id, timestamp);
      return user;
    })();
    response.status(201).json(user);
  });
  app.get('/api/preferences', (_request, response) =>
    response.json(samples.preferences(authenticatedUser(response).id)),
  );
  app.put('/api/preferences', (request, response) =>
    response.json(
      samples.setPreferences(
        authenticatedUser(response).id,
        preferencesSchema.parse(request.body),
      ),
    ),
  );

  // On-access generation keeps overdue alerts persisted without a second scheduler process.
  app.use('/api', (_request, _response, next) => {
    samples.refreshOverdueAlerts();
    next();
  });

  app.get('/api/dashboard', (_request, response) =>
    response.json(samples.dashboard(requireStaff(response).timezone)),
  );
  app.get('/api/samples', (request, response) =>
    response.json(
      samples.list(
        filtersSchema.parse(request.query),
        authenticatedUser(response),
      ),
    ),
  );
  app.post('/api/samples', (request, response) =>
    response
      .status(201)
      .json(
        samples.create(
          sampleSchema.parse(request.body),
          authenticatedUser(response),
        ),
      ),
  );
  app.get('/api/samples/:id', (request, response) =>
    response.json(
      samples.get(resourceId(request.params.id), authenticatedUser(response)),
    ),
  );
  app.get('/api/followups', (_request, response) =>
    response.json(samples.followups(requireStaff(response))),
  );
  app.post('/api/samples/:id/patient-access', (request, response) =>
    response.json(
      samples.setPatientAccess(
        resourceId(request.params.id),
        patientAccessSchema.parse(request.body),
        authenticatedUser(response),
      ),
    ),
  );
  app.post('/api/samples/:id/acknowledge-results', (request, response) =>
    response.json(
      samples.acknowledgeResults(
        resourceId(request.params.id),
        portalActionSchema.parse(request.body),
        authenticatedUser(response),
      ),
    ),
  );
  app.post('/api/samples/:id/remind-clinician', (request, response) =>
    response.json(
      samples.remindClinician(
        resourceId(request.params.id),
        portalActionSchema.parse(request.body),
        authenticatedUser(response),
      ),
    ),
  );
  app.post('/api/samples/:id/transition', (request, response) =>
    response.json(
      samples.transition(
        resourceId(request.params.id),
        transitionSchema.parse(request.body),
        authenticatedUser(response),
      ),
    ),
  );
  app.post('/api/samples/:id/notes', (request, response) =>
    response
      .status(201)
      .json(
        samples.addNote(
          resourceId(request.params.id),
          noteSchema.parse(request.body).text,
          authenticatedUser(response),
        ),
      ),
  );
  app.post('/api/samples/:id/recollection', (request, response) =>
    response.json(
      samples.requestRecollection(
        resourceId(request.params.id),
        recollectionSchema.parse(request.body),
        authenticatedUser(response),
      ),
    ),
  );
  app.post('/api/samples/:id/replacement', (request, response) =>
    response
      .status(201)
      .json(
        samples.registerReplacement(
          resourceId(request.params.id),
          replacementSchema.parse(request.body),
          authenticatedUser(response),
        ),
      ),
  );
  app.get('/api/alerts', (_request, response) => {
    requireStaff(response);
    response.json(samples.alerts());
  });
  app.post('/api/alerts/:id/acknowledge', (request, response) =>
    response.json(
      samples.acknowledgeAlert(
        resourceId(request.params.id),
        authenticatedUser(response),
      ),
    ),
  );
  app.post('/api/alerts/:id/resolve', (request, response) =>
    response.json(
      samples.resolveAlert(
        resourceId(request.params.id),
        resolutionSchema.parse(request.body).resolution,
        authenticatedUser(response),
      ),
    ),
  );
  app.get('/api/notifications', (_request, response) =>
    response.json(samples.notifications(authenticatedUser(response).id)),
  );
  app.post('/api/notifications/:id/read', (request, response) =>
    response.json(
      samples.readNotification(
        resourceId(request.params.id),
        authenticatedUser(response).id,
      ),
    ),
  );
  app.use('/api', (_request, _response, next) =>
    next(new ApiError(404, 'API route not found.', 'NOT_FOUND')),
  );

  if (options.staticDirectory) {
    const staticDirectory = resolve(options.staticDirectory);
    app.use(express.static(staticDirectory, { index: false, maxAge: 0 }));
    app.get('/{*path}', (_request, response) =>
      response.sendFile(resolve(staticDirectory, 'index.html')),
    );
  }

  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    _next,
  ) => {
    if (error instanceof z.ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of error.issues)
        fields[issue.path.join('.') || 'form'] ??= issue.message;
      response.status(400).json({
        message: 'Check the highlighted fields and try again.',
        code: 'VALIDATION_ERROR',
        fields,
      });
    } else if (error instanceof ApiError) {
      if (error.status === 429) response.setHeader('Retry-After', '900');
      response
        .status(error.status)
        .json({ message: error.message, code: error.code });
    } else if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({
        message: 'Request body must contain valid JSON.',
        code: 'INVALID_JSON',
      });
    } else if (
      typeof error === 'object' &&
      error &&
      'type' in error &&
      error.type === 'entity.too.large'
    ) {
      response.status(413).json({
        message: 'Request body is too large.',
        code: 'BODY_TOO_LARGE',
      });
    } else {
      // Avoid writing request bodies, patient information, or credentials to process logs.
      console.error(
        'LabLink request failed:',
        error instanceof Error ? error.name : 'UnknownError',
      );
      response.status(500).json({
        message:
          'The request could not be completed. Try again or contact the administrator.',
        code: 'INTERNAL_ERROR',
      });
    }
  };
  app.use(errorHandler);
  return {
    app,
    database,
    samples,
    communications,
    close: () => database.close(),
  };
}
