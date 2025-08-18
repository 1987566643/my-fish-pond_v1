'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function RegisterPage(){
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [err,setErr]=useState<string|undefined>();

  async function onSubmit(e:React.FormEvent){
    e.preventDefault();
    setErr(undefined);
    const res = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username,password})});
    if(res.ok) location.href='/pond';
    else setErr((await res.json()).error || '注册失败');
  }

  return (
    <div className="panel" style={{maxWidth:420, margin:'4rem auto'}}>
      <h2>注册</h2>
      <form onSubmit={onSubmit} className="grid">
        <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="用户名（字母数字下划线，≥3）" autoFocus />
        <input value={password} onChange={e=>setPassword(e.target.value)} placeholder="密码（≥6）" type="password" />
        {err && <div className="muted" style={{color:'#ffb4b4'}}>{err}</div>}
        <button className="ghost" type="submit">注册并登录</button>
      </form>
      <div className="muted" style={{marginTop:8}}>已有账号？<Link href="/login">去登录</Link></div>
    </div>
  );
}
