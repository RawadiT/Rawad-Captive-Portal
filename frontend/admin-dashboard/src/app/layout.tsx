import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'لوحة الإدارة | روتانا - شركة رواد التقنيات',
  description: 'لوحة التحكم الإدارية لنظام Captive Portal',
  icons: {
    icon: '/logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="font-cairo antialiased bg-slate-50 text-slate-900">
        {children}
      </body>
    </html>
  );
}
