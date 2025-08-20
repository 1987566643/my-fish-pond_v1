// lib/auth.ts
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const COOKIE = 'fp_session';
const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-me');

export type Session = { id: string; username: string };

/** 写入 7 天会话 */
export async function setSession(user: Session) {
  const token = await new SignJWT(user)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
  cookies().set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
}

/** 清除会话 */
export function clearSession() {
  cookies().set(COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' });
}

/** 读取并校验会话；无效返回 null */
export async function getSession(): Promise<Session | null> {
  const c = cookies().get(COOKIE)?.value;
  if (!c) return null;
  try {
    const { payload } = await jwtVerify(c, secret);
    return { id: String(payload.id), username: String(payload.username) };
  } catch {
    return null;
  }
}

/** ✅ 适配 API 使用：仅返回用户 id（无会话时返回 null） */
export async function getSessionUserId(): Promise<string | null> {
  const s = await getSession();
  return s?.id ?? null;
}

/** 可选：拿用户名（有时写公告栏快照方便） */
export async function getSessionUsername(): Promise<string | null> {
  const s = await getSession();
  return s?.username ?? null;
}
