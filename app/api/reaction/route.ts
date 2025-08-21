// ./app/api/reaction/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

/**
 * 计算“今天(北京时间) 4:00”的边界（SQL CTE）
 * 说明：不要在 JS 里算，以免时区/部署容器时区导致偏差。
 * 这里写成一段可复用的 SQL 片段（直接内联在模板字符串里）。
 *
 * 产生 day_start.s: 当天(北京时间)4:00，如果当前北京时间 <4 点则回退到前一天 4:00
 */
const DAY_BOUNDARY_CTE = /*sql*/`
WITH now_bj AS (
  SELECT timezone('Asia/Shanghai', now()) AS t
),
day_start AS (
  SELECT
    (date_trunc('day', t) + interval '4 hours'
     - CASE WHEN EXTRACT(HOUR FROM t) < 4 THEN interval '1 day' ELSE interval '0' END) AS s
  FROM now_bj
)
`;

/**
 * GET /api/reaction
 * 返回“今天(北京时间4点为界)”当前用户对各鱼的投票 map
 * { ok: true, votes: { [fish_id]: 1 | -1 } }
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 查出今天的投票
  const { rows } = await sql/*sql*/`
    ${sql`/* day boundary */`}
    ${DAY_BOUNDARY_CTE}
    SELECT r.fish_id, MAX(r.value) AS value
    FROM reactions r, day_start ds
    WHERE r.user_id = ${session.id}
      AND timezone('Asia/Shanghai', r.created_at) >= ds.s
      AND timezone('Asia/Shanghai', r.created_at) <  ds.s + interval '1 day'
    GROUP BY r.fish_id
  `;

  const votes: Record<string, 1 | -1> = Object.create(null);
  for (const row of rows as Array<{ fish_id: string; value: number }>) {
    if (row.value === 1 || row.value === -1) votes[row.fish_id] = row.value as 1 | -1;
  }
  return NextResponse.json({ ok: true, votes });
}

/**
 * POST /api/reaction
 * body: { fishId: string, value: 1 | -1 }   // 传 1 表示点赞，-1 表示点踩
 * 行为：
 *  - 今天没投 -> 插入(value)；给 fish.<likes|dislikes> +1
 *  - 今天投过 & value 相同 -> 视为“撤销”；删除该投票；给对应字段 -1（不低于 0）
 *  - 今天投过 & value 相反 -> 更新为新 value；原字段 -1，新字段 +1
 * 返回：{ ok: true, state: -1|0|1, likes, dislikes }
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const fishId: string | undefined = body?.fishId;
  const value: 1 | -1 | undefined = body?.value;

  if (!fishId || (value !== 1 && value !== -1)) {
    return NextResponse.json({ error: 'bad_params' }, { status: 400 });
  }

  try {
    // 开启事务，避免两边计数不一致
    await sql/*sql*/`BEGIN`;

    // 取今天的既有投票（北京时间 4 点为界）
    const prevQuery = await sql/*sql*/`
      ${DAY_BOUNDARY_CTE}
      SELECT r.id, r.value
      FROM reactions r, day_start ds
      WHERE r.user_id = ${session.id}
        AND r.fish_id = ${fishId}
        AND timezone('Asia/Shanghai', r.created_at) >= ds.s
        AND timezone('Asia/Shanghai', r.created_at) <  ds.s + interval '1 day'
      ORDER BY r.created_at DESC
      LIMIT 1
    `;

    const prev = prevQuery.rows[0] as { id: string; value: number } | undefined;

    let newState: -1 | 0 | 1 = 0;

    if (!prev) {
      // 今天还没有投票：插入新投票
      await sql/*sql*/`
        INSERT INTO reactions (user_id, fish_id, value)
        VALUES (${session.id}, ${fishId}, ${value})
      `;
      if (value === 1) {
        await sql/*sql*/`UPDATE fish SET likes = COALESCE(likes,0) + 1 WHERE id = ${fishId}`;
        newState = 1;
      } else {
        await sql/*sql*/`UPDATE fish SET dislikes = COALESCE(dislikes,0) + 1 WHERE id = ${fishId}`;
        newState = -1;
      }
    } else {
      const prevVal = prev.value;

      if (prevVal === value) {
        // 与之前相同 -> 撤销（删除）
        await sql/*sql*/`DELETE FROM reactions WHERE id = ${prev.id}`;

        if (value === 1) {
          await sql/*sql*/`UPDATE fish SET likes = GREATEST(0, COALESCE(likes,0) - 1) WHERE id = ${fishId}`;
        } else {
          await sql/*sql*/`UPDATE fish SET dislikes = GREATEST(0, COALESCE(dislikes,0) - 1) WHERE id = ${fishId}`;
        }
        newState = 0;
      } else {
        // 与之前相反 -> 切换
        await sql/*sql*/`
          UPDATE reactions
          SET value = ${value}, created_at = now()
          WHERE id = ${prev.id}
        `;
        if (prevVal === 1) {
          await sql/*sql*/`UPDATE fish SET likes = GREATEST(0, COALESCE(likes,0) - 1) WHERE id = ${fishId}`;
        } else if (prevVal === -1) {
          await sql/*sql*/`UPDATE fish SET dislikes = GREATEST(0, COALESCE(dislikes,0) - 1) WHERE id = ${fishId}`;
        }
        if (value === 1) {
          await sql/*sql*/`UPDATE fish SET likes = COALESCE(likes,0) + 1 WHERE id = ${fishId}`;
          newState = 1;
        } else {
          await sql/*sql*/`UPDATE fish SET dislikes = COALESCE(dislikes,0) + 1 WHERE id = ${fishId}`;
          newState = -1;
        }
      }
    }

    // 读最新计数返回
    const latest = await sql/*sql*/`
      SELECT COALESCE(likes,0) AS likes, COALESCE(dislikes,0) AS dislikes
      FROM fish WHERE id = ${fishId}
    `;
    const likes = Number((latest.rows[0] as any)?.likes ?? 0);
    const dislikes = Number((latest.rows[0] as any)?.dislikes ?? 0);

    await sql/*sql*/`COMMIT`;
    return NextResponse.json({ ok: true, state: newState, likes, dislikes });
  } catch (e) {
    try { await sql/*sql*/`ROLLBACK`; } catch {}
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
