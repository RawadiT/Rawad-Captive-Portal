'use client';

import React, { useCallback, useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

type TabKey = 'dashboard' | 'active' | 'users' | 'admins' | 'logs';

interface AdminUser {
  id: string;
  username: string;
  display_name: string;
  role: 'super_admin' | 'admin';
  is_active: boolean;
  created_at: string;
}

interface DashboardStats {
  activeUsersCount: number;
  totalUsersCount: number;
  activeSessionsCount: number;
  adminsCount: number;
  mikrotik: {
    connected: boolean;
    mode: string;
    identity: string | null;
    lastCheckedAt: string;
    error: string | null;
  };
}

interface ActiveSession {
  id: string;
  session_type: 'free' | 'user';
  username: string;
  device_name: string | null;
  device_type: string | null;
  device_model: string | null;
  mac_address: string;
  ip_address: string;
  status: string;
  remaining_seconds: number | null;
  started_at: string;
}

interface CustomerUser {
  id: string;
  username: string;
  display_name: string | null;
  quota_seconds: number | null;
  used_seconds: number;
  remaining_seconds: number | null;
  status: 'active' | 'disabled' | 'banned' | 'expired';
  created_at: string;
}

interface AuditLog {
  id: string;
  admin_username: string;
  action: string;
  target_type: string;
  target_label: string | null;
  ip_address: string;
  previous_value: string | null;
  new_value: string | null;
  created_at: string;
}

function formatDuration(sec: number | null): string {
  if (sec === null) return 'مفتوح';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}س ${m}د ${r}ث`;
  return `${m}د ${r}ث`;
}

function formatBaghdadDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-IQ', {
      timeZone: 'Asia/Baghdad',
      dateStyle: 'short',
      timeStyle: 'medium',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function AdminDashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<AdminUser | null>(null);
  const [tab, setTab] = useState<TabKey>('dashboard');

  // Login state
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerSuccess, setBannerSuccess] = useState<string | null>(null);

  // Data state
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [users, setUsers] = useState<CustomerUser[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);

  // Create user form
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newMinutes, setNewMinutes] = useState('60');
  const [isUnlimited, setIsUnlimited] = useState(false);

  // Create admin form
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminDisplay, setAdminDisplay] = useState('');
  const [adminRole, setAdminRole] = useState<'admin' | 'super_admin'>('admin');

  const apiFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(`${API_URL}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(init?.headers || {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setToken(null);
        setMe(null);
        window.sessionStorage.removeItem('rawad_admin_token');
        window.sessionStorage.removeItem('rawad_admin_me');
      }
      if (!res.ok) {
        throw new Error(data.error || 'فشل الطلب');
      }
      return data;
    },
    [token]
  );

  useEffect(() => {
    const savedToken = window.sessionStorage.getItem('rawad_admin_token');
    const savedMe = window.sessionStorage.getItem('rawad_admin_me');
    if (savedToken && savedMe) {
      setToken(savedToken);
      try {
        setMe(JSON.parse(savedMe) as AdminUser);
      } catch {
        // ignore
      }
    }
  }, []);

  const refreshStaticLists = useCallback(async () => {
    if (!token) return;
    try {
      const [uRes, aRes, lRes] = await Promise.all([
        apiFetch('/api/admin/users'),
        apiFetch('/api/admin/admins'),
        apiFetch('/api/admin/audit-logs?limit=100'),
      ]);
      setUsers(uRes.users || []);
      setAdmins(aRes.admins || []);
      setLogs(lRes.logs || []);
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'تعذر تحديث البيانات');
    }
  }, [token, apiFetch]);

  useEffect(() => {
    if (token) {
      void refreshStaticLists();
    }
  }, [token, refreshStaticLists]);

  // Real-time SSE stream for stats + active sessions (every ~2.5s without page reload)
  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`${API_URL}/api/admin/events?token=${encodeURIComponent(token)}`);
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data) as { stats: DashboardStats; sessions: ActiveSession[] };
        setStats(payload.stats);
        setActiveSessions(payload.sessions);
      } catch {
        // ignore malformed event
      }
    };
    return () => es.close();
  }, [token]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerError(null);
    setLoginLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'بيانات الدخول غير صحيحة');
      setToken(data.token);
      setMe(data.admin);
      window.sessionStorage.setItem('rawad_admin_token', data.token);
      window.sessionStorage.setItem('rawad_admin_me', JSON.stringify(data.admin));
      setLoginPass('');
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'فشل تسجيل الدخول');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setMe(null);
    window.sessionStorage.removeItem('rawad_admin_token');
    window.sessionStorage.removeItem('rawad_admin_me');
  };

  const handleTerminateSession = async (id: string) => {
    setBannerError(null);
    setBannerSuccess(null);
    try {
      await apiFetch(`/api/admin/sessions/${id}/terminate`, { method: 'POST' });
      setBannerSuccess('تم إنهاء الجلسة وقطع الإنترنت عن الجهاز');
      void refreshStaticLists();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'تعذر إنهاء الجلسة');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerError(null);
    setBannerSuccess(null);
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          display_name: newDisplayName || null,
          quota_minutes: isUnlimited ? null : Number(newMinutes),
        }),
      });
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      setBannerSuccess('تم إنشاء حساب المستخدم بنجاح');
      await refreshStaticLists();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'تعذر إنشاء المستخدم');
    }
  };

  const handleUserStatus = async (id: string, status: CustomerUser['status']) => {
    setBannerError(null);
    setBannerSuccess(null);
    try {
      await apiFetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setBannerSuccess('تم تحديث حالة المستخدم بنجاح');
      await refreshStaticLists();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'تعذر تحديث الحالة');
    }
  };

  const handleDeleteUser = async (id: string) => {
    setBannerError(null);
    setBannerSuccess(null);
    try {
      await apiFetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      setBannerSuccess('تم حذف الحساب بنجاح');
      await refreshStaticLists();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'تعذر حذف الحساب');
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerError(null);
    setBannerSuccess(null);
    try {
      await apiFetch('/api/admin/admins', {
        method: 'POST',
        body: JSON.stringify({
          username: adminUsername,
          password: adminPassword,
          display_name: adminDisplay,
          role: adminRole,
        }),
      });
      setAdminUsername('');
      setAdminPassword('');
      setAdminDisplay('');
      setBannerSuccess('تم إنشاء حساب المدير بنجاح');
      await refreshStaticLists();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'تعذر إنشاء المدير');
    }
  };

  const handleToggleAdminActive = async (a: AdminUser) => {
    setBannerError(null);
    setBannerSuccess(null);
    try {
      await apiFetch(`/api/admin/admins/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active: !a.is_active }),
      });
      setBannerSuccess('تم تحديث حالة المدير');
      await refreshStaticLists();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'تعذر تعديل حساب المدير');
    }
  };

  if (!token || !me) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-[#06133a] to-[#0a1d5c] flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl bg-white/95 backdrop-blur-xl shadow-2xl p-8">
          <div className="flex flex-col items-center text-center mb-6">
            <img src="/logo.png" alt="شعار شركة رواد التقنيات" className="w-20 h-20 rounded-full object-contain mb-3 shadow-md" />
            <h1 className="text-xl font-extrabold text-slate-900">روتانا - شركة رواد التقنيات</h1>
            <p className="text-sm text-slate-500 mt-1">لوحة التحكم الإدارية</p>
          </div>

          {bannerError && (
            <div className="mb-4 rounded-xl bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
              {bannerError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">اسم المستخدم</label>
              <input
                type="text"
                required
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">كلمة المرور</label>
              <input
                type="password"
                required
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-3 rounded-xl bg-gradient-to-l from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-sm shadow-lg shadow-blue-600/25 transition-all disabled:opacity-50"
            >
              {loginLoading ? 'جارٍ الدخول...' : 'دخول إلى لوحة الإدارة'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="شعار شركة رواد التقنيات" className="w-10 h-10 rounded-full object-contain border border-slate-200" />
            <div>
              <h1 className="text-sm sm:text-base font-extrabold text-slate-900">
                روتانا - شركة رواد التقنيات
              </h1>
              <p className="text-[11px] text-slate-500">لوحة إدارة شبكة الزبائن</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div
              className={`hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                stats?.mikrotik.connected
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  stats?.mikrotik.connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'
                }`}
              />
              {stats?.mikrotik.connected
                ? `متصل بالراوتر (${stats.mikrotik.identity || stats.mikrotik.mode})`
                : 'الراوتر غير متصل'}
            </div>

            <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg">
              {me.display_name} ({me.role === 'super_admin' ? 'مدير رئيسي' : 'مدير'})
            </span>

            <button
              onClick={handleLogout}
              className="text-xs font-bold text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              خروج
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-2 overflow-x-auto pb-2">
          {(
            [
              ['dashboard', 'لوحة المؤشرات'],
              ['active', `المتصلون حالياً (${activeSessions.length})`],
              ['users', 'إدارة المستخدمين'],
              ['admins', 'إدارة المدراء'],
              ['logs', 'سجل العمليات'],
            ] as Array<[TabKey, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold whitespace-nowrap transition-all ${
                tab === key
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 flex-1 space-y-6">
        {bannerError && (
          <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm font-medium">
            {bannerError}
          </div>
        )}
        {bannerSuccess && (
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 text-sm font-medium">
            {bannerSuccess}
          </div>
        )}

        {/* 1. Dashboard Tab */}
        {tab === 'dashboard' && (
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="rounded-2xl bg-white p-5 border border-slate-200 shadow-sm">
              <p className="text-xs font-semibold text-slate-500">المستخدمون النشطون</p>
              <p className="text-3xl font-extrabold text-blue-700 mt-2">{stats?.activeUsersCount ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 border border-slate-200 shadow-sm">
              <p className="text-xs font-semibold text-slate-500">إجمالي الحسابات</p>
              <p className="text-3xl font-extrabold text-slate-900 mt-2">{stats?.totalUsersCount ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 border border-slate-200 shadow-sm">
              <p className="text-xs font-semibold text-slate-500">جلسات الاتصال الحالية</p>
              <p className="text-3xl font-extrabold text-indigo-700 mt-2">{stats?.activeSessionsCount ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 border border-slate-200 shadow-sm">
              <p className="text-xs font-semibold text-slate-500">حسابات المدراء</p>
              <p className="text-3xl font-extrabold text-slate-900 mt-2">{stats?.adminsCount ?? 0}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 border border-slate-200 shadow-sm">
              <p className="text-xs font-semibold text-slate-500">حالة اتصال MikroTik</p>
              <p
                className={`text-sm font-extrabold mt-3 ${
                  stats?.mikrotik.connected ? 'text-emerald-600' : 'text-red-600'
                }`}
              >
                {stats?.mikrotik.connected ? 'متصل' : 'غير متصل'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">{stats?.mikrotik.mode || '—'}</p>
            </div>
          </section>
        )}

        {/* 2. Active Users Tab */}
        {tab === 'active' && (
          <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-900">الأجهزة المتصلة حالياً (تحديث لحظي)</h2>
              <span className="text-xs text-slate-500">يتحدث تلقائياً كل 2.5 ثانية</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs sm:text-sm">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">اسم الجهاز</th>
                    <th className="py-3 px-4">MAC Address</th>
                    <th className="py-3 px-4">IP Address</th>
                    <th className="py-3 px-4">نوع الجهاز</th>
                    <th className="py-3 px-4">طراز الجهاز</th>
                    <th className="py-3 px-4">اسم المستخدم</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4">الوقت المتبقي</th>
                    <th className="py-3 px-4">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeSessions.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400">
                        لا توجد أجهزة متصلة حالياً
                      </td>
                    </tr>
                  ) : (
                    activeSessions.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4">{s.device_name || 'غير معروف'}</td>
                        <td className="py-3 px-4 font-mono" dir="ltr">{s.mac_address}</td>
                        <td className="py-3 px-4 font-mono" dir="ltr">{s.ip_address}</td>
                        <td className="py-3 px-4">{s.device_type || 'غير معروف'}</td>
                        <td className="py-3 px-4">{s.device_model || 'غير معروف'}</td>
                        <td className="py-3 px-4 font-semibold">{s.username}</td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                            متصل
                          </span>
                        </td>
                        <td className="py-3 px-4 font-semibold text-blue-700">
                          {formatDuration(s.remaining_seconds)}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => void handleTerminateSession(s.id)}
                            className="px-3 py-1 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold"
                          >
                            إنهاء الجلسة
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* 3. User Management Tab */}
        {tab === 'users' && (
          <div className="space-y-6">
            <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
              <h2 className="text-base font-extrabold text-slate-900 mb-4">إنشاء حساب زبون جديد</h2>
              <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">اسم المستخدم</label>
                  <input
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">كلمة المرور</label>
                  <input
                    type="password"
                    required
                    minLength={4}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">الاسم (اختياري)</label>
                  <input
                    value={newDisplayName}
                    onChange={(e) => setNewDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">المدة (بالدقائق)</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      disabled={isUnlimited}
                      value={newMinutes}
                      onChange={(e) => setNewMinutes(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
                    />
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={isUnlimited}
                        onChange={(e) => setIsUnlimited(e.target.checked)}
                      />
                      مفتوح
                    </label>
                  </div>
                </div>
                <button
                  type="submit"
                  className="py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm"
                >
                  إنشاء الحساب
                </button>
              </form>
            </section>

            <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs sm:text-sm">
                  <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">اسم المستخدم</th>
                      <th className="py-3 px-4">المدة الكلية</th>
                      <th className="py-3 px-4">المستهلك</th>
                      <th className="py-3 px-4">المتبقي</th>
                      <th className="py-3 px-4">الحالة</th>
                      <th className="py-3 px-4">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-bold">{u.username}</td>
                        <td className="py-3 px-4">{formatDuration(u.quota_seconds)}</td>
                        <td className="py-3 px-4">{formatDuration(u.used_seconds)}</td>
                        <td className="py-3 px-4 font-semibold text-blue-700">
                          {formatDuration(u.remaining_seconds)}
                        </td>
                        <td className="py-3 px-4">{u.status}</td>
                        <td className="py-3 px-4 flex flex-wrap gap-1.5">
                          {u.status !== 'active' && (
                            <button
                              onClick={() => void handleUserStatus(u.id, 'active')}
                              className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold"
                            >
                              تفعيل
                            </button>
                          )}
                          {u.status === 'active' && (
                            <button
                              onClick={() => void handleUserStatus(u.id, 'disabled')}
                              className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold"
                            >
                              تعطيل
                            </button>
                          )}
                          {u.status !== 'banned' && (
                            <button
                              onClick={() => void handleUserStatus(u.id, 'banned')}
                              className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 text-xs font-bold"
                            >
                              حظر
                            </button>
                          )}
                          <button
                            onClick={() => void handleDeleteUser(u.id)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold"
                          >
                            حذف
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* 4. Admin Management Tab */}
        {tab === 'admins' && (
          <div className="space-y-6">
            {me.role === 'super_admin' && (
              <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                <h2 className="text-base font-extrabold text-slate-900 mb-4">إنشاء حساب مدير جديد</h2>
                <form onSubmit={handleCreateAdmin} className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">اسم المستخدم</label>
                    <input
                      required
                      value={adminUsername}
                      onChange={(e) => setAdminUsername(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">كلمة المرور</label>
                    <input
                      type="password"
                      required
                      minLength={4}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">الاسم الظاهر</label>
                    <input
                      required
                      value={adminDisplay}
                      onChange={(e) => setAdminDisplay(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">الصلاحية</label>
                    <select
                      value={adminRole}
                      onChange={(e) => setAdminRole(e.target.value as 'admin' | 'super_admin')}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="admin">مدير عادي</option>
                      <option value="super_admin">مدير رئيسي</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    className="py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm"
                  >
                    إضافة مدير
                  </button>
                </form>
              </section>
            )}

            <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-right text-xs sm:text-sm">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">اسم المستخدم</th>
                    <th className="py-3 px-4">الاسم</th>
                    <th className="py-3 px-4">الدور</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {admins.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold">{a.username}</td>
                      <td className="py-3 px-4">{a.display_name}</td>
                      <td className="py-3 px-4">{a.role === 'super_admin' ? 'مدير رئيسي' : 'مدير عادي'}</td>
                      <td className="py-3 px-4">{a.is_active ? 'نشط' : 'معطل'}</td>
                      <td className="py-3 px-4">
                        {me.role === 'super_admin' && a.id !== me.id && (
                          <button
                            onClick={() => void handleToggleAdminActive(a)}
                            className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold"
                          >
                            {a.is_active ? 'تعطيل' : 'تفعيل'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {/* 5. Immutable Activity Logs Tab */}
        {tab === 'logs' && (
          <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-900">سجل العمليات الإدارية (غير قابل للتعديل أو الحذف)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-4">المدير</th>
                    <th className="py-3 px-4">العملية</th>
                    <th className="py-3 px-4">الحساب المتأثر</th>
                    <th className="py-3 px-4">IP المدير</th>
                    <th className="py-3 px-4">الوقت (بغداد)</th>
                    <th className="py-3 px-4">التفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {logs.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold">{l.admin_username}</td>
                      <td className="py-3 px-4 font-mono">{l.action}</td>
                      <td className="py-3 px-4">{l.target_label || '—'}</td>
                      <td className="py-3 px-4 font-mono" dir="ltr">{l.ip_address}</td>
                      <td className="py-3 px-4">{formatBaghdadDateTime(l.created_at)}</td>
                      <td className="py-3 px-4 max-w-xs truncate font-mono text-[11px] text-slate-500">
                        {l.new_value || l.previous_value || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
