import { Suspense, lazy } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, useLocation } from 'wouter';
import { queryClient, useSession } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { ErrorBoundary } from '@/components/error-boundary';
import { ErrorState, LoadingState } from '@/components/domain';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import SignInPage from '@/pages/sign-in';
import NotFound from '@/pages/not-found';
import { isStaff } from '@/lib/roles';

const Dashboard = lazy(() => import('@/pages/dashboard'));
const SamplesPage = lazy(() => import('@/pages/samples'));
const SampleDetailPage = lazy(() => import('@/pages/sample-detail'));
const AlertsPage = lazy(() => import('@/pages/alerts'));
const NotificationsPage = lazy(() => import('@/pages/notifications'));
const SettingsPage = lazy(() => import('@/pages/settings'));
const PortalPage = lazy(() => import('@/pages/portal'));
const PortalDetailPage = lazy(() => import('@/pages/portal-detail'));
const FollowupsPage = lazy(() => import('@/pages/followups'));
const CommunicationsPage = lazy(() => import('@/pages/communications'));
const IntegrationPage = lazy(() => import('@/pages/integration'));

function AuthenticatedApp() {
  const session = useSession();
  const [location] = useLocation();
  if (session.isLoading)
    return (
      <main className="mx-auto max-w-lg p-10">
        <LoadingState />
      </main>
    );
  if (session.isError || !session.data)
    return (
      <main className="mx-auto max-w-xl p-10">
        <ErrorState error={session.error} onRetry={() => session.refetch()} />
      </main>
    );
  if (!session.data.user) return <SignInPage session={session.data} />;
  const staff = isStaff(session.data.user.role);
  const admin = session.data.user.role === 'admin';
  return (
    <AppShell>
      <ErrorBoundary resetKey={location}>
        <Suspense fallback={<LoadingState />}>
          <Switch>
            <Route path="/" component={staff ? Dashboard : PortalPage} />
            <Route
              path="/samples"
              component={staff ? SamplesPage : PortalPage}
            />
            <Route
              path="/samples/:id"
              component={staff ? SampleDetailPage : PortalDetailPage}
            />
            {staff && <Route path="/alerts" component={AlertsPage} />}
            {staff && <Route path="/followups" component={FollowupsPage} />}
            {admin && (
              <Route path="/communications" component={CommunicationsPage} />
            )}
            {admin && <Route path="/integration" component={IntegrationPage} />}
            <Route path="/notifications" component={NotificationsPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthenticatedApp />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
