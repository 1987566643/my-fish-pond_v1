'use client';

import useSWR from 'swr';
import { useState } from 'react';

const fetcher = (u:string)=>fetch(u).then(r=>r.json());

export default function BoardPage(){
  const { data, mutate } = useSWR('/api/messages', fetcher, { refreshInterval: 4000 });
  const [content, setContent] = useState('');

  async function postMsg(e:React.FormEvent){
    e.preventDefault();
    if(!content.trim()) return;
    await fetch('/api/messages', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ content })});
    setContent('');
    mutate();
  }

  return (
    <div className="panel">
      <h3>留言板</h3>
      <form onSubmit={postMsg} className="grid" style={{gridTemplateColumns:'1fr auto', alignItems:'start', gap:8}}>
        <textarea value={content} onChange={e=>setContent(e.target.value)} placeholder="想说的话（≤500字）" />
        <button className="ghost" style={{height:40, alignSelf:'center'}}>发送</button>
      </form>
      <ul style={{marginTop:16}}>
        {data?.messages?.map((m:any)=>(
          <li key={m.id} style={{marginBottom:10}}>
            <div><strong>@{m.username}</strong> <span className="muted" style={{fontSize:12}}>{new Date(m.created_at).toLocaleString()}</span></div>
            <div style={{whiteSpace:'pre-wrap'}}>{m.content}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
