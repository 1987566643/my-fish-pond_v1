import { NextResponse } from 'next/server';
import { sql } from '../../../lib/db';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { setSession } from '../../../lib/auth';

const schema = z.object({
  username: z.string().min(3).max(20),
  password: z.string().min(6).max(100)
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: '参数不合法' }, { status: 400 });

  const { username, password } = parsed.data;
  const { rows } = await sql`SELECT id, username, password_hash FROM users WHERE username=${username} LIMIT 1`;
  const user = rows[0];
  if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return NextResponse.json({ error: '密码不正确' }, { status: 401 });

  await setSession({ id: user.id, username: user.username });
  return NextResponse.json({ ok: true });
}
