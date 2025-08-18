import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';

const COOKIE = 'fp_session';
const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'dev-secret-change-me');

export type Session = { id: string; username: string };

export async function setSession(user: Session) {
  const token = await new SignJWT(user)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
  cookies().set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: true, path: '/' });
}

export function clearSession() {
  cookies().set(COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' });
}

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
