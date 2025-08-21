import { NextResponse } from 'next/server';
import { sql } from '../../../../lib/db';

const TOKEN = process.env.CRON_SECRET || '';

function ok(data: any = { ok: true }) {
  return NextResponse.json(data, { status: 200 });
}
function noauth(msg = 'forbidden') {
  return NextResponse.json({ error: msg }, { status: 403 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';

  // 允许两种“这是 Vercel Cron”的判断之一：
  const hasCronHeader = req.headers.get('x-vercel-cron') !== null; // 标准做法
  const ua = req.headers.get('user-agent') || '';
  const looksLikeVercelCron = /^vercel-cron\//i.test(ua);          // 兜底：从 UA 判断

  // 鉴权：Vercel Cron（header 或 UA 命中）直接放行；否则需要 ?token=CRON_SECRET
  if (!(hasCronHeader || looksLikeVercelCron)) {
    if (!TOKEN || token !== TOKEN) return noauth();
  }

  try {
    await sql/*sql*/`
      UPDATE users
      SET today_catch = 0
    `;
    return ok();
  } catch (e) {
    console.error('reset-today-catch failed', e);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}

// 允许 POST 也触发（兼容手动调用）
export const POST = GET;
