import './globals.css';
import Link from 'next/link';
import { getSession, clearSession } from '../lib/auth';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Fish Pond', description: '多人画鱼 & 钓鱼' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <html lang="zh-CN">
      <body>
        <header className="topbar">
          <div className="brand">🐟 Fish Pond</div>
          <nav className="nav">
            {session ? (
              <>
                <Link href="/pond">池塘</Link>
                <Link href="/mine">我的</Link>
                <Link href="/board">留言板</Link>
                <form action={async () => { 'use server'; clearSession(); redirect('/'); }}>
                  <button className="ghost">退出</button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login">登录</Link>
                <Link href="/register" className="primary">注册</Link>
              </>
            )}
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
