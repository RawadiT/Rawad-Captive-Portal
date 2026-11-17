'use client';

import React, { useEffect, useState } from 'react';

interface CircularTimerProps {
  initialRemainingSeconds: number | null;
  totalAllowedSeconds: number | null;
  expiresAt: string | null;
  onExpired: () => void;
}

function formatTime(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function CircularTimer({
  initialRemainingSeconds,
  totalAllowedSeconds,
  expiresAt,
  onExpired,
}: CircularTimerProps) {
  const [remaining, setRemaining] = useState<number | null>(initialRemainingSeconds);

  useEffect(() => {
    setRemaining(initialRemainingSeconds);
  }, [initialRemainingSeconds]);

  useEffect(() => {
    if (remaining === null) return;
    const id = setInterval(() => {
      setRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(id);
          onExpired();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [remaining !== null, onExpired]);

  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  const ratio =
    remaining !== null && totalAllowedSeconds && totalAllowedSeconds > 0
      ? Math.max(0, Math.min(1, remaining / totalAllowedSeconds))
      : 1;
  const strokeDashoffset = circumference * (1 - ratio);

  const formattedExpiry = expiresAt
    ? new Intl.DateTimeFormat('ar-IQ', {
        timeZone: 'Asia/Baghdad',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(expiresAt))
    : null;

  return (
    <div className="flex flex-col items-center justify-center my-4">
      <div className="relative w-52 h-52 flex items-center justify-center">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
          <circle
            cx="100"
            cy="100"
            r={radius}
            stroke="rgba(148, 163, 184, 0.2)"
            strokeWidth="12"
            fill="none"
          />
          <circle
            cx="100"
            cy="100"
            r={radius}
            stroke="url(#rawadTimerGrad)"
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-[stroke-dashoffset] duration-700 ease-linear"
          />
          <defs>
            <linearGradient id="rawadTimerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#4f46e5" />
            </linearGradient>
          </defs>
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs font-medium text-blue-200/80 mb-1">الوقت المتبقي</span>
          <span
            dir="ltr"
            className="text-3xl font-extrabold tracking-wider text-white tabular-nums"
          >
            {remaining === null ? 'مفتوح' : formatTime(remaining)}
          </span>
          {formattedExpiry && (
            <span className="text-[11px] text-slate-300 mt-1">
              ينتهي الساعة {formattedExpiry}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
