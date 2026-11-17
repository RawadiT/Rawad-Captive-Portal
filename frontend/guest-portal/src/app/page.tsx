'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CircularTimer } from '@/components/CircularTimer';
import { TechBackground } from '@/components/TechBackground';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface SessionData {
  id: string;
  session_type: 'free' | 'user';
  mac_address: string;
  ip_address: string;
  allowed_seconds: number | null;
  consumed_seconds: number;
  expires_at: string | null;
}

interface StatusResponse {
  connected: boolean;
  session: SessionData | null;
  remainingSeconds: number | null;
  freeEligible: boolean;
  freeReason: string | null;
  nextResetAt: string;
}

function getUrlHintParams(): { mac: string | null; ip: string | null } {
  if (typeof window === 'undefined') return { mac: null, ip: null };
  const params = new URLSearchParams(window.location.search);
  return { mac: params.get('mac'), ip: params.get('ip') };
}

export default function GuestPortalPage() {
  const [macAddress, setMacAddress] = useState<string>('');
  const [ipAddress, setIpAddress] = useState<string>('192.168.20.10');
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<'free' | 'login' | 'disconnect' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [expiredNotice, setExpiredNotice] = useState<boolean>(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const fetchStatus = useCallback(async (mac?: string | null) => {
    try {
      const qs = mac ? `?mac=${encodeURIComponent(mac)}` : '';
      const res = await fetch(`${API_URL}/api/guest/status${qs}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'تعذر الاتصال بخادم البوابة');
      }
      const data = (await res.json()) as StatusResponse & { macAddress?: string; ipAddress?: string };
      setStatus(data);
      if (data.macAddress) setMacAddress(data.macAddress);
      if (data.ipAddress) setIpAddress(data.ipAddress);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر التحقق من حالة الاتصال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const { mac, ip } = getUrlHintParams();
    if (mac) setMacAddress(mac);
    if (ip) setIpAddress(ip);
    void fetchStatus(mac);
  }, [fetchStatus]);

  // Periodically resync active session with backend every 10 seconds
  useEffect(() => {
    if (!status?.connected || !macAddress) return;
    const id = setInterval(() => {
      void fetchStatus(macAddress);
    }, 10000);
    return () => clearInterval(id);
  }, [status?.connected, macAddress, fetchStatus]);

  const handleFreeAccess = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setExpiredNotice(false);
    setActionLoading('free');
    try {
      const res = await fetch(`${API_URL}/api/guest/free`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ macAddress, ipAddress }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'تعذر تفعيل الإنترنت المجاني');
      }
      setSuccessMsg('تم تفعيل 30 دقيقة مجانية بنجاح!');
      await fetchStatus(macAddress);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setActionLoading(null);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setExpiredNotice(false);
    setActionLoading('login');
    try {
      const res = await fetch(`${API_URL}/api/guest/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, macAddress, ipAddress }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل تسجيل الدخول');
      }
      setSuccessMsg('تم تسجيل الدخول وتفعيل الإنترنت بنجاح!');
      setPassword('');
      await fetchStatus(macAddress);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'حدث خطأ أثناء تسجيل الدخول');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisconnect = async () => {
    setActionLoading('disconnect');
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await fetch(`${API_URL}/api/guest/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ macAddress }),
      });
      await fetchStatus(macAddress);
    } catch {
      setErrorMsg('تعذر قطع الاتصال');
    } finally {
      setActionLoading(null);
    }
  };

  const handleExpired = useCallback(() => {
    setExpiredNotice(true);
    setSuccessMsg(null);
    if (macAddress) {
      void fetchStatus(macAddress);
    }
  }, [macAddress, fetchStatus]);

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center px-4 py-8 overflow-x-hidden">
      <TechBackground />

      <div className="relative z-10 w-full max-w-md">
        {/* Official Logo & Company Name */}
        <header className="flex flex-col items-center text-center mb-6">
          <div className="w-28 h-28 rounded-full p-1.5 bg-white/90 shadow-2xl shadow-blue-600/30 ring-4 ring-blue-400/20 mb-4 flex items-center justify-center">
            <img
              src="/logo.png"
              alt="شعار شركة رواد التقنيات"
              className="w-full h-full object-contain rounded-full"
            />
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight drop-shadow-sm">
            روتانا - شركة رواد التقنيات
          </h1>
          <p className="text-sm text-blue-200/85 mt-1">
            بوابة الدخول إلى شبكة Wi-Fi للزبائن
          </p>
        </header>

        {/* Main Glassmorphism Card */}
        <section className="rounded-3xl bg-white/10 backdrop-blur-xl border border-white/20 shadow-2xl shadow-blue-950/50 p-6 sm:p-7 transition-all duration-300">
          {errorMsg && (
            <div
              role="alert"
              className="mb-4 rounded-2xl bg-red-500/20 border border-red-400/40 text-red-100 px-4 py-3 text-sm font-medium"
            >
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div
              role="status"
              className="mb-4 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 px-4 py-3 text-sm font-medium"
            >
              {successMsg}
            </div>
          )}

          {expiredNotice && (
            <div
              role="alert"
              className="mb-4 rounded-2xl bg-amber-500/20 border border-amber-400/40 text-amber-100 px-4 py-3 text-sm font-medium"
            >
              انتهى وقت الجلسة وتم قطع الإنترنت.
            </div>
          )}

          {loading ? (
            <div className="py-12 flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full border-4 border-blue-400/30 border-t-blue-400 animate-spin" />
              <p className="text-sm text-blue-100">جارٍ التحقق من حالة الاتصال...</p>
            </div>
          ) : status?.connected && status.session ? (
            /* Connected View with Circular Timer */
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-200 text-xs font-semibold mb-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                متصل بالإنترنت —{' '}
                {status.session.session_type === 'free' ? 'الباقة المجانية (30 دقيقة)' : 'حساب مشترك'}
              </div>

              <CircularTimer
                initialRemainingSeconds={status.remainingSeconds}
                totalAllowedSeconds={status.session.allowed_seconds}
                expiresAt={status.session.expires_at}
                onExpired={handleExpired}
              />

              <div className="mt-2 mb-5 rounded-2xl bg-slate-900/40 border border-white/10 p-3 text-xs text-slate-300 flex justify-between">
                <span>عنوان الجهاز (MAC):</span>
                <span dir="ltr" className="font-mono text-blue-200">
                  {status.session.mac_address}
                </span>
              </div>

              <button
                type="button"
                onClick={handleDisconnect}
                disabled={actionLoading === 'disconnect'}
                className="w-full py-3 rounded-2xl bg-white/10 hover:bg-red-500/25 active:scale-[0.98] border border-white/20 hover:border-red-400/40 text-white font-semibold text-sm transition-all duration-200 disabled:opacity-50"
              >
                {actionLoading === 'disconnect' ? 'جارٍ قطع الاتصال...' : 'قطع الاتصال'}
              </button>
            </div>
          ) : (
            /* Login View — ONLY TWO OPTIONS (Free 30 Min + Username/Password Login) */
            <div className="space-y-6">
              {/* Option A: Free 30-Minute Internet */}
              <div>
                <button
                  type="button"
                  onClick={handleFreeAccess}
                  disabled={!status?.freeEligible || actionLoading !== null}
                  className="w-full py-3.5 px-5 rounded-2xl bg-gradient-to-l from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] text-white font-bold text-base shadow-lg shadow-blue-600/35 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {actionLoading === 'free' ? (
                    <>
                      <span className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      <span>جارٍ التفعيل...</span>
                    </>
                  ) : (
                    <span>الحصول على 30 دقيقة مجانية</span>
                  )}
                </button>
                {!status?.freeEligible && status?.freeReason && (
                  <p className="mt-2 text-xs text-amber-200/90 text-center leading-relaxed">
                    {status.freeReason}
                  </p>
                )}
              </div>

              <div className="relative flex items-center justify-center">
                <div className="border-t border-white/15 w-full" />
                <span className="px-3 text-xs text-blue-200/70 bg-transparent shrink-0">أو</span>
                <div className="border-t border-white/15 w-full" />
              </div>

              {/* Option B: Username & Password Login */}
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label htmlFor="username" className="block text-xs font-semibold text-blue-100 mb-1.5">
                    اسم المستخدم
                  </label>
                  <input
                    id="username"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="أدخل اسم المستخدم"
                    className="w-full rounded-xl bg-slate-900/50 border border-white/15 px-4 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-xs font-semibold text-blue-100 mb-1.5">
                    كلمة المرور
                  </label>
                  <input
                    id="password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="أدخل كلمة المرور"
                    className="w-full rounded-xl bg-slate-900/50 border border-white/15 px-4 py-2.5 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
                  />
                </div>

                <button
                  type="submit"
                  disabled={actionLoading !== null}
                  className="w-full py-3 rounded-2xl bg-white/15 hover:bg-white/25 active:scale-[0.98] border border-white/25 text-white font-bold text-sm transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {actionLoading === 'login' ? (
                    <>
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      <span>جارٍ تسجيل الدخول...</span>
                    </>
                  ) : (
                    <span>تسجيل الدخول</span>
                  )}
                </button>
              </form>
            </div>
          )}
        </section>

        {/* Manual fallback notice for OSes without automatic Captive Portal popup */}
        <footer className="mt-5 text-center text-[11px] text-blue-200/70 leading-relaxed">
          إذا لم تفتح هذه الصفحة تلقائياً عند الاتصال بالشبكة، افتح المتصفح وانتقل إلى{' '}
          <span dir="ltr" className="font-mono text-blue-200 underline">
            https://wifi.YOUR_COMPANY_DOMAIN.com
          </span>
        </footer>
      </div>
    </main>
  );
}
