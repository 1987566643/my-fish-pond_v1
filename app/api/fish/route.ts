// app/api/fish/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const session = await getSession().catch(() => null);

    // 全历史聚合 likes/dislikes；不加任何时间过滤
    const { rows } = await sql/*sql*/`
      SELECT
        f.id, f.name, f.data_url, f.w, f.h, f.created_at, f.in_pond,
        u.username AS owner_name,
        COALESCE(SUM(CASE WHEN r.value = 1  THEN 1 ELSE 0 END), 0)::int AS likes,
        COALESCE(SUM(CASE WHEN r.value = -1 THEN 1 ELSE 0 END), 0)::int AS dislikes
      FROM fish f
      JOIN users u ON u.id = f.owner_id
      LEFT JOIN reactions r ON r.fish_id = f.id
      WHERE f.in_pond = TRUE
      GROUP BY f.id, u.username
      ORDER BY f.created_at DESC
    `;

    // 需要的话，也可以顺便返回“我今天对每条鱼的投票”，前端用来点亮按钮
    // 但为简单起见，这里不拼接；悬浮卡首次出现时不亮，点击后前端本地亮即可

    return NextResponse.json({ ok: true, fish: rows });
  } catch (e) {
    console.error('GET /api/fish failed', e);
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
