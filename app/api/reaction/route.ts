import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 北京时间4点为界的当日窗口 */
function bj4Window() {
  const now = new Date();

  // 以北京时区计算本地 4:00 边界（不依赖服务器时区）
  const bjNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const start = new Date(bjNow);
  start.setHours(4, 0, 0, 0);
  if (bjNow.getTime() < start.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  // 转 UTC ISO，送到数据库用 timestamptz 比较
  const startISO = new Date(start.toISOString());
  const endISO = new Date(end.toISOString());
  return { startISO, endISO };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({} as any));
  const fishId = String(body.fishId || '');
  const inVal = body.value;
  const value: 1 | -1 = inVal === 1 ? 1 : -1; // 只接受 1 或 -1

  if (!fishId) {
    return NextResponse.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }

  const { startISO, endISO } = bj4Window();

  try {
    // 1) 可选校验：鱼是否存在（不强依赖 in_pond，允许对不在池塘的鱼展示历史/排行榜）
    const fishCheck = await sql/*sql*/`
      SELECT id FROM fish WHERE id = ${fishId} LIMIT 1
    `;
    if (fishCheck.rowCount === 0) {
      return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    }

    // 2) 查出今天该用户对该鱼的最近一条投票
    const prev = await sql/*sql*/`
      SELECT id, value
      FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const prevRow = prev.rows[0] as { id: string; value: number } | undefined;

    // 3) 先删掉今天的投票（保证“每天最多一条”的幂等约束）
    await sql/*sql*/`
      DELETE FROM reactions
      WHERE user_id = ${session.id}
        AND fish_id = ${fishId}
        AND created_at >= ${startISO}
        AND created_at <  ${endISO}
    `;

    // 4) 判断是否是“取消”还是“切换/新增”
    let my_vote: 1 | -1 | null = null;
    if (!prevRow || prevRow.value !== value) {
      // 没投过 或 与上一次不同 → 插入新投票
      await sql/*sql*/`
        INSERT INTO reactions (user_id, fish_id, value)
        VALUES (${session.id}, ${fishId}, ${value})
      `;
      my_vote = value;
    } else {
      // 与上一次相同 → 本次视为“取消”（已在上一步删除），不再插入
      my_vote = null;
    }

    // 5) 统计该鱼的累计 likes/dislikes（不加日期限制 = 全时段累积）
    const agg = await sql/*sql*/`
      SELECT
        COALESCE(SUM(CASE WHEN value = 1 THEN 1 ELSE 0 END), 0)::int AS likes,
        COALESCE(SUM(CASE WHEN value = -1 THEN 1 ELSE 0 END), 0)::int AS dislikes
      FROM reactions
      WHERE fish_id = ${fishId}
    `;
    const likes = Number(agg.rows[0]?.likes ?? 0);
    const dislikes = Number(agg.rows[0]?.dislikes ?? 0);

    return NextResponse.json({ ok: true, likes, dislikes, my_vote });
  } catch (e) {
    // 为了定位问题，返回一个简短的错误码
    return NextResponse.json({ ok: false, error: 'server_error' }, { status: 500 });
  }
}
