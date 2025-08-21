
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

/**
 * POST /api/reaction
 * body: { fishId: string, value: 1 | -1 }
 * 点赞/点踩：幂等 upsert
 */
// 计算“今天（以北京时间 4:00 为界）”的 SQL 片段
const DAY_EXPR = `((created_at AT TIME ZONE 'Asia/Shanghai') - interval '4 hours')::date`;
const NOW_DAY  = `((now()       AT TIME ZONE 'Asia/Shanghai') - interval '4 hours')::date`;

export async function GET() {
  // 返回：今天我对哪些鱼点过赞/踩（value: 1 | -1）
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  try {
    const { rows } = await sql/*sql*/`
      SELECT fish_id, value
      FROM reactions
      WHERE user_id = ${session.id}
        AND ${sql.raw(DAY_EXPR)} = ${sql.raw(NOW_DAY)}
    `;
    // 组装成 map: { [fish_id]: 1 | -1 }
    const map: Record<string, 1 | -1> = Object.create(null);
    for (const r of rows as any[]) map[r.fish_id] = r.value;
    return NextResponse.json({ ok: true, reactions: map });
  } catch (e) {
    console.error('GET /api/reaction error', e);
    return NextResponse.json({ ok: false, reactions: {} }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  try {
    const { fishId, value } = (await req.json()) as { fishId?: string; value?: 1 | -1 };
    if (!fishId || (value !== 1 && value !== -1)) {
      return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
    }

    // 1) 查今天已有记录
    const { rows: exRows } = await sql/*sql*/`
      SELECT id, value
      FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND ${sql.raw(DAY_EXPR)} = ${sql.raw(NOW_DAY)}
      LIMIT 1
    `;
    const existing = (exRows as any[])[0] as { id: string; value: 1 | -1 } | undefined;

    let my_reaction: 0 | 1 | -1 = 0;

    if (!existing) {
      // 2) 初次评价：写入 reactions，并累加 fish 计数
      await sql/*sql*/`
        INSERT INTO reactions(user_id, fish_id, value)
        VALUES (${session.id}, ${fishId}, ${value})
      `;
      if (value === 1) {
        await sql/*sql*/`UPDATE fish SET likes = likes + 1 WHERE id = ${fishId}`;
      } else {
        await sql/*sql*/`UPDATE fish SET dislikes = dislikes + 1 WHERE id = ${fishId}`;
      }
      my_reaction = value;
    } else if (existing.value === value) {
      // 3) 再点同一个：取消
      await sql/*sql*/`DELETE FROM reactions WHERE id = ${existing.id}`;
      if (value === 1) {
        await sql/*sql*/`UPDATE fish SET likes = GREATEST(0, likes - 1) WHERE id = ${fishId}`;
      } else {
        await sql/*sql*/`UPDATE fish SET dislikes = GREATEST(0, dislikes - 1) WHERE id = ${fishId}`;
      }
      my_reaction = 0;
    } else {
      // 4) 与之前相反：切换
      await sql/*sql*/`
        UPDATE reactions
        SET value = ${value}, created_at = now()
        WHERE id = ${existing.id}
      `;
      if (value === 1) {
        await sql/*sql*/`
          UPDATE fish
          SET likes = likes + 1,
              dislikes = GREATEST(0, dislikes - 1)
          WHERE id = ${fishId}
        `;
      } else {
        await sql/*sql*/`
          UPDATE fish
          SET dislikes = dislikes + 1,
              likes = GREATEST(0, likes - 1)
          WHERE id = ${fishId}
        `;
      }
      my_reaction = value;
    }

    // 5) 返回最新计数
    const { rows: cnt } = await sql/*sql*/`
      SELECT likes, dislikes FROM fish WHERE id = ${fishId}
    `;
    const { likes, dislikes } = (cnt as any[])[0] || { likes: 0, dislikes: 0 };

    return NextResponse.json({ ok: true, likes, dislikes, my_reaction });
  } catch (e) {
    console.error('POST /api/reaction failed', e);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
