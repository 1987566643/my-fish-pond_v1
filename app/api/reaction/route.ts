
import { NextResponse } from 'next/server';
import { getSession } from '../../../lib/auth';
import { sql } from '../../../lib/db';

/**
 * POST /api/reaction
 * body: { fishId: string, value: 1 | -1 }
 * 点赞/点踩：幂等 upsert
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { fishId, value } = await req.json();
  if (!fishId || ![1,-1].includes(Number(value))) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  // 创建表（容错：第一次调用自动创建）
  await sql/*sql*/`
    CREATE TABLE IF NOT EXISTS fish_reactions (
      fish_id UUID NOT NULL REFERENCES fish(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value   SMALLINT NOT NULL CHECK (value IN (1, -1)),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (fish_id, user_id)
    );
  `;

  // upsert
  await sql/*sql*/`
    INSERT INTO fish_reactions (fish_id, user_id, value)
    VALUES (${fishId}, ${s.id}, ${value})
    ON CONFLICT (fish_id, user_id) DO UPDATE SET value = EXCLUDED.value
  `;

  return NextResponse.json({ ok: true });
}
