import { NextResponse } from 'next/server';
import { sql } from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { setSession } from '../../../lib/auth';

const schema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6).max(100)
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '参数不合法' }, { status: 400 });

  const { username, password } = parsed.data;
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await sql`INSERT INTO users (username, password_hash) VALUES (${username}, ${hash}) RETURNING id, username`;
    await setSession(rows[0]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (String(e?.message || '').includes('duplicate')) {
      return NextResponse.json({ error: '用户名已被占用' }, { status: 409 });
    }
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
