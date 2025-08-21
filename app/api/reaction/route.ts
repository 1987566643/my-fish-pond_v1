// ./app/api/reaction/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

/**
 * GET /api/reaction
 * 返回当前登录用户“今天(北京时间4点为界)”对各条鱼的投票态：
 * { ok: true, votes: { [fishId]: -1 | 0 | 1 } }
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.id) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const { rows } = await sql/*sql*/`
      WITH local_now AS (
        SELECT (NOW() AT TIME ZONE 'Asia/Shanghai') AS lnow
      ),
      day_start AS (
        SELECT CASE
          WHEN (lnow::time) < TIME '04:00'
            THEN (date_trunc('day', lnow) - INTERVAL '1 day' + TIME '04:00')
          ELSE (date_trunc('day', lnow) + TIME '04:00')
        END AS start_local
        FROM local_now
      ),
      day_start_utc AS (
        SELECT (start_local AT TIME ZONE 'Asia/Shanghai') AS start_utc
        FROM day_start
      )
      SELECT r.fish_id, (ARRAY_AGG(r.value ORDER BY r.created_at DESC))[1] AS value
      FROM reactions r
      CROSS JOIN day_start_utc ds
      WHERE r.user_id = ${session.id}
        AND r.created_at >= ds.start_utc
      GROUP BY r.fish_id
    `;

    const map: Record<string, -1 | 0 | 1> = Object.create(null);
    for (const r of rows) {
      const v = Number(r.value);
      map[r.fish_id as string] = (v === 1 || v === -1 || v === 0) ? (v as -1 | 0 | 1) : 0;
    }

    return NextResponse.json({ ok: true, votes: map });
  } catch (e) {
    console.error('GET /api/reaction failed', e);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}

/**
 * POST /api/reaction
 * body: { fishId: string, value: 1 | -1 }
 * 逻辑：同一用户对同一条鱼“当天（4点为界）”只有一个最终态，允许撤销（再写入 0），允许切换（-1<->1）。
 * 同步累计：fish.likes / fish.dislikes。
 * 响应：{ ok: true, state: -1|0|1, likes: number, dislikes: number }
 */
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.id) {
      return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const fishId: string = body?.fishId;
    const value: 1 | -1 = body?.value;

    if (!fishId || (value !== 1 && value !== -1)) {
      return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
    }

    // 事务：读取今日最新态 → 计算新态 & 计数增量 → 写 reactions(记录) & 更新 fish 计数 → 返回最新计数
    const result = await sql.begin(async (tx) => {
      // 1) 计算北京时间 4 点“今日起点(UTC)”，并拿该用户对该鱼今日最新一条记录
      const prevRows = await tx/*sql*/`
        WITH local_now AS (
          SELECT (NOW() AT TIME ZONE 'Asia/Shanghai') AS lnow
        ),
        day_start AS (
          SELECT CASE
            WHEN (lnow::time) < TIME '04:00'
              THEN (date_trunc('day', lnow) - INTERVAL '1 day' + TIME '04:00')
            ELSE (date_trunc('day', lnow) + TIME '04:00')
          END AS start_local
          FROM local_now
        ),
        day_start_utc AS (
          SELECT (start_local AT TIME ZONE 'Asia/Shanghai') AS start_utc
          FROM day_start
        )
        SELECT r.value
        FROM reactions r
        CROSS JOIN day_start_utc ds
        WHERE r.user_id = ${session.id}
          AND r.fish_id = ${fishId}
          AND r.created_at >= ds.start_utc
        ORDER BY r.created_at DESC
        LIMIT 1
      `;
      const prev: -1 | 0 | 1 = prevRows.rows.length ? (Number(prevRows.rows[0].value) as -1 | 0 | 1) : 0;

      // 2) 决策新态 & 计数增量
      //   - 点击与当前相同 => 撤销 -> 新态 0；计数 -1（对应的那一侧）
      //   - 点击与当前相反 => 切换 -> 旧侧 -1，新侧 +1
      //   - 当前 0 => 直接设为 value -> 新侧 +1
      let nextState: -1 | 0 | 1 = prev;
      let likeDelta = 0;
      let dislikeDelta = 0;

      if (prev === value) {
        // 撤销
        nextState = 0;
        if (value === 1) likeDelta = -1;
        else dislikeDelta = -1;
      } else if (prev === 0) {
        // 首次设置
        nextState = value;
        if (value === 1) likeDelta = 1;
        else dislikeDelta = 1;
      } else {
        // 切换 -1 <-> 1
        nextState = value;
        if (value === 1) { likeDelta = 1; dislikeDelta = -1; }
        else { likeDelta = -1; dislikeDelta = 1; }
      }

      // 3) 写一条 reactions 记录（记录撤销时 value=0）
      await tx/*sql*/`
        INSERT INTO reactions (id, user_id, fish_id, value, created_at)
        VALUES (gen_random_uuid(), ${session.id}, ${fishId}, ${nextState}, NOW())
      `;

      // 4) 更新 fish 聚合计数
      if (likeDelta !== 0 || dislikeDelta !== 0) {
        await tx/*sql*/`
          UPDATE fish
          SET likes = GREATEST(0, likes + ${likeDelta}),
              dislikes = GREATEST(0, dislikes + ${dislikeDelta})
          WHERE id = ${fishId}
        `;
      }

      // 5) 读回最新聚合
      const agg = await tx/*sql*/`
        SELECT likes, dislikes
        FROM fish
        WHERE id = ${fishId}
        LIMIT 1
      `;
      const likes = Number(agg.rows[0]?.likes ?? 0);
      const dislikes = Number(agg.rows[0]?.dislikes ?? 0);

      return { state: nextState, likes, dislikes };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('POST /api/reaction failed', e);
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
