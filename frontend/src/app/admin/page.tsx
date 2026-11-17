'use client';

import React, { useCallback, useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface CustomerUser {
  id: string;
  username: string;
  duration_minutes: number;
  started_at: string | null;
  expires_at: string | null;
  remaining_seconds: number | null;
  is_disabled: boolean;
  is_expired: boolean;
  created_at: string;
}

interface FreeQuotaItem {
  mac_address: string;
  started_at: string;
  expires_at: string;
  remaining_seconds: number;
  is_expired: boolean;
}

function formatDuration(sec: number | null): string {
  if (sec === null) return '—';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}س ${m}د ${r}ث`;
  return `${m}د ${r}ث`;
}

function formatTime(iso: string | null): string {
  if (!iso) return 'لم يبدأ بعد';
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

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [adminName, setAdminName] = useState<string>('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [users, setUsers] = useState<CustomerUser[]>([]);
  const [quotas, setQuotas] = useState<FreeQuotaItem[]>([]);
  const [tab, setTab] = useState<'users' | 'free'>('users');

  // Create user form
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [durationValue, setDurationValue] = useState('120');
  const [durationUnit, setDurationUnit] = useState<'minutes' | 'hours'>('minutes');

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
        window.sessionStorage.removeItem('rawad_admin_token');
      }
      if (!res.ok) throw new Error(data.error || 'فشل الطلب');
      return data;
    },
    [token]
  );

  useEffect(() => {
    const saved = window.sessionStorage.getItem('rawad_admin_token');
    const savedName = window.sessionStorage.getItem('rawad_admin_name');
    if (saved) setToken(saved);
    if (savedName) setAdminName(savedName);
  }, []);

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const [uRes, qRes] = await Promise.all([
        apiFetch('/api/admin/users'),
        apiFetch('/api/admin/free-quotas'),
      ]);
      setUsers(uRes.users || []);
      setQuotas(qRes.quotas || []);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحميل البيانات');
    }
  }, [token, apiFetch]);

  useEffect(() => {
    if (token) {
      void loadData();
      const id = setInterval(() => void loadData(), 5000);
      return () => clearInterval(id);
    }
  }, [token, loadData]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'بيانات الدخول غير صحيحة');
      setToken(data.token);
      setAdminName(data.admin.username);
      window.sessionStorage.setItem('rawad_admin_token', data.token);
      window.sessionStorage.setItem('rawad_admin_name', data.admin.username);
      setPassword('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'فشل تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    const num = Number(durationValue);
    const durationMinutes = durationUnit === 'hours' ? num * 60 : num;
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          duration_minutes: durationMinutes,
        }),
      });
      setNewUsername('');
      setNewPassword('');
      setSuccessMsg('تم إنشاء الحساب بنجاح');
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إنشاء الحساب');
    }
  };

  const handleToggleDisable = async (u: CustomerUser) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await apiFetch(`/api/admin/users/${u.id}/disable`, {
        method: 'PATCH',
        body: JSON.stringify({ is_disabled: !u.is_disabled }),
      });
      setSuccessMsg(u.is_disabled ? 'تم تفعيل الحساب' : 'تم تعطيل الحساب');
      await loadData();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تحديث الحساب');
    }
  };

  const handleLogout = () => {
    setToken(null);
    window.sessionStorage.removeItem('rawad_admin_token');
    window.sessionStorage.removeItem('rawad_admin_name');
  };

  if (!token) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-[#06133a] to-[#0a1d5c] flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl bg-white/95 backdrop-blur-xl shadow-2xl p-8 text-slate-900">
          <div className="flex flex-col items-center text-center mb-6">
            <img src="/logo.png" alt="شعار شركة رواد التقنيات" className="w-20 h-20 rounded-full object-contain mb-3 shadow-md" />
            <h1 className="text-xl font-extrabold">روتانا - شركة رواد التقنيات</h1>
            <p className="text-sm text-slate-500 mt-1">لوحة الإدارة</p>
          </div>
          {errorMsg && (
            <div className="mb-4 rounded-xl bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">
              {errorMsg}
            </div>
          )}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">اسم المستخدم</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">كلمة المرور</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm"
            >
              {loading ? 'جارٍ الدخول...' : 'تسجيل الدخول'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="شعار شركة رواد التقنيات" className="w-10 h-10 rounded-full object-contain border border-slate-200" />
            <div>
              <h1 className="text-sm sm:text-base font-extrabold">روتانا - شركة رواد التقنيات</h1>
              <p className="text-[11px] text-slate-500">إدارة حسابات Captive Portal</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold bg-slate-100 px-3 py-1.5 rounded-lg">{adminName}</span>
            <button onClick={handleLogout} className="text-xs font-bold text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg">
              خروج
            </button>
          </div>
        </div>
        <nav className="max-w-6xl mx-auto px-4 flex gap-2 pb-2">
          <button
            onClick={() => setTab('users')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold ${tab === 'users' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            الحسابات ({users.length})
          </button>
          <button
            onClick={() => setTab('free')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold ${tab === 'free' ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
          >
            سجلات الحصة المجانية ({quotas.length})
          </button>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {errorMsg && <div className="rounded-xl bg-red-50 border border-red-200 text-red-700 px-4 py-3 text-sm">{errorMsg}</div>}
        {successMsg && <div className="rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 px-4 py-3 text-sm">{successMsg}</div>}

        {tab === 'users' && (
          <>
            <section className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
              <h2 className="text-base font-extrabold mb-4">إنشاء حساب جديد</h2>
              <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">اسم المستخدم</label>
                  <input required value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">كلمة المرور</label>
                  <input type="password" required minLength={4} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">المدة</label>
                  <div className="flex gap-2">
                    <input type="number" min={1} required value={durationValue} onChange={(e) => setDurationValue(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
                    <select value={durationUnit} onChange={(e) => setDurationUnit(e.target.value as 'minutes' | 'hours')} className="rounded-xl border border-slate-300 px-2 py-2 text-sm">
                      <option value="minutes">دقيقة</option>
                      <option value="hours">ساعة</option>
                    </select>
                  </div>
                </div>
                <button type="submit" className="py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm">
                  إنشاء الحساب
                </button>
              </form>
            </section>

            <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-x-auto">
              <table className="w-full text-right text-xs sm:text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-3 px-4">اسم المستخدم</th>
                    <th className="py-3 px-4">المدة</th>
                    <th className="py-3 px-4">وقت البداية</th>
                    <th className="py-3 px-4">وقت الانتهاء</th>
                    <th className="py-3 px-4">الوقت المتبقي</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4">إجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold">{u.username}</td>
                      <td className="py-3 px-4">{u.duration_minutes} دقيقة</td>
                      <td className="py-3 px-4">{formatTime(u.started_at)}</td>
                      <td className="py-3 px-4">{formatTime(u.expires_at)}</td>
                      <td className="py-3 px-4 font-semibold text-blue-700">{formatDuration(u.remaining_seconds)}</td>
                      <td className="py-3 px-4">
                        {u.is_disabled ? 'معطل' : u.is_expired ? 'منتهي' : u.started_at ? 'نشط' : 'جاهز'}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          onClick={() => void handleToggleDisable(u)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold ${u.is_disabled ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}
                        >
                          {u.is_disabled ? 'تفعيل' : 'تعطيل'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        {tab === 'free' && (
          <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-x-auto">
            <table className="w-full text-right text-xs sm:text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-3 px-4">MAC Address</th>
                  <th className="py-3 px-4">وقت البداية</th>
                  <th className="py-3 px-4">وقت الانتهاء</th>
                  <th className="py-3 px-4">الوقت المتبقي</th>
                  <th className="py-3 px-4">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {quotas.map((q) => (
                  <tr key={q.mac_address} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono" dir="ltr">{q.mac_address}</td>
                    <td className="py-3 px-4">{formatTime(q.started_at)}</td>
                    <td className="py-3 px-4">{formatTime(q.expires_at)}</td>
                    <td className="py-3 px-4 font-semibold text-blue-700">{formatDuration(q.remaining_seconds)}</td>
                    <td className="py-3 px-4">{q.is_expired ? 'مستهلكة ومنتهية' : 'جارية'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </div>
  );
}
