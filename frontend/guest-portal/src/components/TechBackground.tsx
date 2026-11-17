'use client';

import React from 'react';

interface FloatingItem {
  id: string;
  top: string;
  left: string;
  size: number;
  opacity: string;
  speedClass: string;
  delay: string;
  icon: 'phone' | 'laptop' | 'monitor' | 'router' | 'wifi';
}

const ITEMS: FloatingItem[] = [
  { id: '1', top: '8%', left: '10%', size: 46, opacity: 'opacity-20', speedClass: 'tech-float-slow', delay: '0s', icon: 'wifi' },
  { id: '2', top: '14%', left: '82%', size: 54, opacity: 'opacity-15', speedClass: 'tech-float-medium', delay: '1.2s', icon: 'laptop' },
  { id: '3', top: '32%', left: '6%', size: 40, opacity: 'opacity-20', speedClass: 'tech-float-fast', delay: '0.5s', icon: 'phone' },
  { id: '4', top: '42%', left: '88%', size: 48, opacity: 'opacity-15', speedClass: 'tech-float-slow', delay: '2s', icon: 'router' },
  { id: '5', top: '65%', left: '12%', size: 52, opacity: 'opacity-15', speedClass: 'tech-float-medium', delay: '0.8s', icon: 'monitor' },
  { id: '6', top: '74%', left: '80%', size: 42, opacity: 'opacity-20', speedClass: 'tech-float-fast', delay: '1.5s', icon: 'phone' },
  { id: '7', top: '86%', left: '26%', size: 44, opacity: 'opacity-15', speedClass: 'tech-float-slow', delay: '2.6s', icon: 'wifi' },
  { id: '8', top: '20%', left: '48%', size: 36, opacity: 'opacity-10', speedClass: 'tech-float-medium', delay: '1.9s', icon: 'router' },
  { id: '9', top: '84%', left: '62%', size: 46, opacity: 'opacity-15', speedClass: 'tech-float-slow', delay: '0.3s', icon: 'laptop' },
];

function TechSvg({ icon, size }: { icon: FloatingItem['icon']; size: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (icon) {
    case 'phone':
      return (
        <svg {...common}>
          <rect x="6" y="2" width="12" height="20" rx="2.5" />
          <path d="M11 18h2" />
        </svg>
      );
    case 'laptop':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M2 19h20" />
        </svg>
      );
    case 'monitor':
      return (
        <svg {...common}>
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      );
    case 'router':
      return (
        <svg {...common}>
          <rect x="2" y="13" width="20" height="7" rx="2" />
          <path d="M6 13V8M18 13V8M6 16.5h.01M10 16.5h.01M15 16.5h3" />
        </svg>
      );
    case 'wifi':
      return (
        <svg {...common}>
          <path d="M5 12.55a11 11 0 0 1 14.08 0" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <path d="M12 20h.01" />
        </svg>
      );
  }
}

export const TechBackground = React.memo(function TechBackground() {
  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 overflow-hidden pointer-events-none select-none z-0"
    >
      {/* Base deep royal gradient matching Rawad Tech brand */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-[#06133a] to-[#0a1d5c]" />

      {/* Soft ambient glow orbs */}
      <div className="absolute -top-32 -right-24 w-96 h-96 rounded-full bg-blue-600/20 blur-3xl" />
      <div className="absolute -bottom-32 -left-24 w-96 h-96 rounded-full bg-indigo-600/20 blur-3xl" />

      {/* Subtle grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #93c5fd 1px, transparent 1px), linear-gradient(to bottom, #93c5fd 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Floating GPU-accelerated SVG tech icons */}
      {ITEMS.map((item) => (
        <div
          key={item.id}
          className={`absolute text-blue-300 ${item.opacity} ${item.speedClass}`}
          style={{
            top: item.top,
            left: item.left,
            animationDelay: item.delay,
          }}
        >
          <TechSvg icon={item.icon} size={item.size} />
        </div>
      ))}
    </div>
  );
});
