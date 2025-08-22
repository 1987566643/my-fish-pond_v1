import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 读取计数（后端为准） */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const { rows } = await sql/*sql*/`
      SELECT today_catch, total_catch
      FROM users
      WHERE id = ${session.id}
    `;
    const today = rows?.[0]?.today_catch ?? 0;
    const total = rows?.[0]?.total_catch ?? 0;
    return NextResponse.json({ ok: true, today_catch: Number(today), total_catch: Number(total) });
  } catch {
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}

/** 钓鱼：成功则 +1 到 today_catch & total_catch */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: any = null;
  try { body = await req.json(); } catch {}
  const fishId: string | undefined = body?.fishId || body?.id;
  if (!fishId) return NextResponse.json({ ok: false, error: 'missing_fish_id' }, { status: 400 });

  try {
    // 1) 原子“收钩”：只在 in_pond=TRUE 时更新成功
    const { rows: upd } = await sql/*sql*/`
      UPDATE fish
      SET in_pond = FALSE
      WHERE id = ${fishId} AND in_pond = TRUE
      RETURNING id, owner_id, name
    `;
    if (upd.length === 0) {
      // 要么被别人先钓走，要么本就不在池塘
      return NextResponse.json({ ok: false, reason: 'already_caught' }, { status: 409 });
    }

    const fish = upd[0] as { id: string; owner_id: string; name: string };

    // 2) catches 记录（可选，失败不影响主流程）
    try {
      await sql/*sql*/`
        INSERT INTO catches (fish_id, angler_id, released, created_at)
        VALUES (${fish.id}, ${session.id}, FALSE, NOW())
      `;
    } catch {
      // 忽略（比如表结构/约束不一致）
    }

    // 3) 计数 +1（一般不会失败）
    try {
      await sql/*sql*/`
        UPDATE users
        SET today_catch = today_catch + 1,
            total_catch = total_catch + 1
        WHERE id = ${session.id}
      `;
    } catch {
      // 极端情况下也不要回滚主流程
    }

    // 4) 公告（可选，枚举不匹配也忽略）
    try {
      // 如果你的枚举不是 'CATCH'，改成库里已有的值（如 'TAKE'）
      await sql/*sql*/`
        INSERT INTO pond_events (
          type, actor_id, target_fish_id, target_owner_id,
          fish_name, owner_username, actor_username, created_at
        )
        VALUES (
          'CATCH',
          ${session.id},
          ${fish.id},
          ${fish.owner_id},
          ${fish.name},
          (SELECT username FROM users WHERE id = ${fish.owner_id}),
          (SELECT username FROM users WHERE id = ${session.id}),
          NOW()
        )
      `;
    } catch {
      // 忽略公告失败
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
