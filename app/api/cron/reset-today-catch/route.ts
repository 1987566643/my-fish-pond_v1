import { NextResponse } from 'next/server';
import { sql } from '../../../../lib/db';

const TOKEN = process.env.CRON_SECRET || '';

function ok(data: any = { ok: true }) {
  return NextResponse.json(data, { status: 200 });
}
function bad(msg = 'forbidden') {
  return NextResponse.json({ error: msg }, { status: 403 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';
  const isVercelCron = req.headers.get('x-vercel-cron') !== null;

  if (!isVercelCron) {
    if (!TOKEN || token !== TOKEN) return bad();
  }

  try {
    await sql/*sql*/`
      UPDATE users
      SET today_catch = 0,
          today_catch_reset_at = now()
    `;
    return ok();
  } catch (e) {
    console.error('reset-today-catch failed', e);
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}

export const POST = GET;
