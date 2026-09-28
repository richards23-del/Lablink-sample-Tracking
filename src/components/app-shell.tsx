import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import {
  AlertCircle,
  Bell,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings2,
  TestTube2,
  ClipboardCheck,
  Mail,
  PlugZap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useLogout, useNotifications, useSession } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { isStaff } from '@/lib/roles';

const staffNavigation = [
  { href: '/', label: 'Command center', icon: LayoutDashboard },
  { href: '/samples', label: 'Sample queue', icon: TestTube2 },
  { href: '/alerts', label: 'Alerts', icon: AlertCircle },
  { href: '/followups', label: 'Follow-ups', icon: ClipboardCheck },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const session = useSession();
  const notifications = useNotifications();
  const logout = useLogout();
  const { toast } = useToast();
  const user = session.data?.user;
  const navigation = [
    ...(isStaff(user?.role)
      ? staffNavigation
      : [
          {
            href: '/',
            label:
              user?.role === 'transporter'
                ? 'Assigned specimens'
                : user?.role === 'clinician'
                  ? 'Clinical requests'
                  : 'My requests',
            icon: TestTube2,
          },
        ]),
    { href: '/notifications', label: 'Notifications', icon: Bell },
    ...(user?.role === 'admin'
      ? [
          { href: '/communications', label: 'Communications', icon: Mail },
          { href: '/integration', label: 'System connection', icon: PlugZap },
        ]
      : []),
    { href: '/settings', label: 'Settings', icon: Settings2 },
  ];
  const unread = notifications.data?.filter((item) => !item.read).length ?? 0;
  const active = navigation.find((item) =>
    item.href === '/' ? location === '/' : location.startsWith(item.href),
  );
  const initials =
    user?.name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((name) => name[0])
      .join('')
      .toUpperCase() ?? '';

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    const media = window.matchMedia('(min-width: 768px)');
    const closeOnDesktop = () => {
      if (media.matches) setMobileOpen(false);
    };
    media.addEventListener('change', closeOnDesktop);
    return () => {
      window.clearInterval(timer);
      media.removeEventListener('change', closeOnDesktop);
    };
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  async function signOut() {
    try {
      await logout.mutateAsync();
    } catch (error) {
      toast({
        title: 'Could not sign out',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  }

  if (!user) return null;

  const sidebar = (
    <>
      <div className="flex h-[76px] shrink-0 items-center gap-3 border-b border-sidebar-border px-6">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
          <FlaskConical size={19} aria-hidden="true" />
        </div>
        <div>
          <div className="text-[17px] font-bold tracking-tight text-white">
            LabLink
          </div>
          <div className="font-mono-ui text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/65">
            Laboratory operations
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-6">
        <div className="mb-3 px-3 font-mono-ui text-[10px] uppercase tracking-[.15em] text-sidebar-foreground/65">
          Workspace
        </div>
        <nav aria-label="Main navigation" className="space-y-1">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active?.href === href ? 'page' : undefined}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center justify-between gap-2 rounded-lg px-3 py-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-primary ${active?.href === href ? 'bg-sidebar-primary text-sidebar-primary-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white'} ${href === '/settings' ? '!mt-8' : ''}`}
            >
              <span className="flex items-center gap-3">
                <Icon size={17} aria-hidden="true" />
                {label}
              </span>
              {href === '/notifications' && unread > 0 && (
                <span
                  className="rounded-full bg-sidebar-accent px-2 py-0.5 text-xs text-white"
                  aria-label={`${unread} unread`}
                >
                  {unread}
                </span>
              )}
            </Link>
          ))}
        </nav>
      </div>
      <div className="shrink-0 border-t border-sidebar-border p-4">
        <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/70 p-3">
          <div
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <div
              className="truncate text-xs font-semibold text-white"
              title={user.name}
            >
              {user.name}
            </div>
            <div className="mt-0.5 text-xs capitalize text-sidebar-foreground/90">
              {user.role}
            </div>
          </div>
        </div>
        <Button
          variant="ghost"
          className="mt-2 w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={signOut}
          disabled={logout.isPending}
        >
          <LogOut aria-hidden="true" />
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-[100dvh] bg-background">
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-[100] rounded-lg bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only"
      >
        Skip to main content
      </a>
      <aside
        aria-label="Workspace navigation"
        className="fixed inset-y-0 left-0 z-40 hidden w-[250px] flex-col bg-sidebar text-sidebar-foreground md:flex"
      >
        {sidebar}
      </aside>
      <div className="md:pl-[250px]">
        <header className="sticky top-0 z-20 flex min-h-[76px] items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open navigation"
                  className="shrink-0 md:hidden"
                >
                  <Menu aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="flex w-[280px] max-w-[90vw] flex-col gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
              >
                <SheetTitle className="sr-only">LabLink navigation</SheetTitle>
                <SheetDescription className="sr-only">
                  Navigate the laboratory workspace or sign out of your account.
                </SheetDescription>
                {sidebar}
              </SheetContent>
            </Sheet>
            <div className="min-w-0 text-xs">
              <div
                className="truncate font-semibold"
                title={user.workspaceName}
              >
                {user.workspaceName}
              </div>
              <div className="mt-1 text-muted-foreground">
                {active?.label ?? 'Workspace'}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <Link
              href="/notifications"
              aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
              className="relative rounded-lg p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <Bell size={18} aria-hidden="true" />
              {unread > 0 && (
                <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-background" />
              )}
            </Link>
            <div className="hidden text-right sm:block">
              <time
                dateTime={now.toISOString()}
                className="block text-xs font-semibold"
              >
                {new Intl.DateTimeFormat('en', {
                  timeZone: user.timezone,
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                }).format(now)}
              </time>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {new Intl.DateTimeFormat('en', {
                  timeZone: user.timezone,
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                }).format(now)}{' '}
                · {user.timezone.replaceAll('_', ' ')}
              </div>
            </div>
            <div
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-full border border-border bg-secondary text-xs font-bold text-secondary-foreground"
            >
              {initials}
            </div>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1500px] p-4 focus:outline-none md:p-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
