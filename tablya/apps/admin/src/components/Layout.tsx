import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';

const NAV: { to: string; key: string; roles: string[] }[] = [
  { to: '/', key: 'nav.dashboard', roles: ['ADMIN', 'SUPPORT'] },
  { to: '/kitchens', key: 'nav.kitchens', roles: ['ADMIN', 'SUPPORT'] },
  { to: '/orders', key: 'nav.orders', roles: ['ADMIN', 'SUPPORT'] },
  { to: '/users', key: 'nav.users', roles: ['ADMIN', 'SUPPORT'] },
  { to: '/moderation', key: 'nav.moderation', roles: ['ADMIN', 'MODERATOR'] },
  { to: '/payments', key: 'nav.payments', roles: ['ADMIN'] },
  { to: '/marketing', key: 'nav.marketing', roles: ['ADMIN'] },
  { to: '/catalog', key: 'nav.catalog', roles: ['ADMIN'] },
  { to: '/support', key: 'nav.support', roles: ['ADMIN', 'SUPPORT'] },
  { to: '/settings', key: 'nav.settings', roles: ['ADMIN'] },
  { to: '/audit', key: 'nav.audit', roles: ['ADMIN'] },
];

export function Layout() {
  const { t, locale, setLocale } = useI18n();
  const { can, logout, session } = useAuth();
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">{t('app.name')}</div>
        <nav className="nav" aria-label="Main">
          {NAV.filter((n) => can(...n.roles)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>{t(n.key)}</NavLink>
          ))}
        </nav>
        <div className="spacer" />
        <small style={{ color: 'var(--muted)', padding: '0 12px' }}>{session?.user.name}</small>
        <button className="btn" onClick={() => setLocale(locale === 'en' ? 'ar' : 'en')}>{t('nav.language')}</button>
        <button className="btn" onClick={() => void logout()}>{t('nav.logout')}</button>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}
