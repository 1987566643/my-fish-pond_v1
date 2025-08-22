import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  let body: any = null;
  try { body = await req.json(); } catch {}
  const fishId: string | undefined = body?.fishId || body?.id;
  if (!fishId) return NextResponse.json({ ok: false, error: 'missing_fish_id' }, { status: 400 });

  try {
    await sql.begin(async (trx) => {
      // 1) 锁住这条鱼，确认仍在池塘
      const { rows } = await trx/*sql*/`
        SELECT id, owner_id, name, in_pond
        FROM fish
        WHERE id = ${fishId}
        FOR UPDATE
      `;
      if (rows.length === 0) {
        throw Object.assign(new Error('not_found'), { status: 404 });
      }
      const fish = rows[0] as { id: string; owner_id: string; name: string; in_pond: boolean };
      if (!fish.in_pond) {
        throw Object.assign(new Error('already_caught'), { status: 409 });
      }

      // 2) 真正的“收钩”：从池塘移除
      await trx/*sql*/`
        UPDATE fish
        SET in_pond = FALSE
        WHERE id = ${fishId}
      `;

      // 3) 记到 catches（可选：有 created_at 兜底）
      try {
        await trx/*sql*/`
          INSERT INTO catches (fish_id, angler_id, released, created_at)
          VALUES (${fishId}, ${session.id}, FALSE, NOW())
        `;
      } catch {
        // 表/列不存在就忽略，别让主流程失败
      }

      // 4) 用户计数 +1（必要，但一般不会报错）
      await trx/*sql*/`
        UPDATE users
        SET today_catch = today_catch + 1,
            total_catch = total_catch + 1
        WHERE id = ${session.id}
      `;

      // 5) 公告（可选：不同项目的枚举有差异，这里兜底）
      try {
        // ⚠️ 如果你的 pond_events.type 枚举不是 'CATCH'，改成你库里已有的那个（比如 'TAKE'）
        await trx/*sql*/`
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
        // 如果枚举/列不匹配就忽略，不影响收钩结果
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = e?.status ?? 500;
    if (status === 404 || status === 409) {
      return NextResponse.json({ ok: false, reason: e.message || 'conflict' }, { status });
    }
    return NextResponse.json({ ok: false, error: 'server' }, { status: 500 });
  }
}
