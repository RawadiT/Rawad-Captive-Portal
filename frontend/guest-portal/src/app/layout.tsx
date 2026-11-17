import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'روتانا - شركة رواد التقنيات | بوابة الإنترنت',
  description: 'بوابة الاتصال اللاسلكي لزبائن روتانا - شركة رواد التقنيات',
  icons: {
    icon: '/logo.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="font-cairo antialiased bg-slate-950 text-slate-100 selection:bg-blue-500/30">
        {children}
      </body>
    </html>
  );
}
