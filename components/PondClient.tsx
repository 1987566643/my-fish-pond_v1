'use client';

import { useEffect, useRef, useState } from 'react';
import { drawHookIcon, HOOK_SIZE } from './HookIcon';

type ServerFish = { id: string; name: string; data_url: string; w: number; h: number };

const palette = ["#ffffff","#000000","#ff6b6b","#ffd166","#06d6a0","#4dabf7","#a78bfa","#ff9f1c","#2ec4b6","#8892b0"];

export default function PondClient(){
  const pondRef = useRef<HTMLCanvasElement>(null);
  const [pondFish, setPondFish] = useState<ServerFish[]>([]);
  const [myCatchCount, setMyCatchCount] = useState(0);

  const drawDlgRef = useRef<HTMLDialogElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const [fishName, setFishName] = useState('');
  const [brush, setBrush] = useState(8);
  const [currentColor, setCurrentColor] = useState(palette[5]);

  const [armed, setArmed] = useState(false);
  const fishingRef = useRef({ hasHook:false, x:0, y:0, biteRadius:20, caughtId:null as null|string });

  async function refreshAll(){
    const res = await fetch('/api/fish', { cache:'no-store' });
    const json = await res.json();
    setPondFish(json.fish);
    const c = await fetch('/api/my-catches', { cache:'no-store' }).then(r=>r.json()).catch(()=>({fish:[]}));
    setMyCatchCount((c.fish||[]).length);
  }
  useEffect(()=>{ refreshAll(); },[]);

  type PondSprite = { id:string; img:HTMLImageElement; w:number; h:number; x:number; y:number; angle:number; speed:number; turn:number; caught:boolean; };
  const spritesRef = useRef<PondSprite[]>([]);
  const lastTs = useRef(performance.now());

  function rebuildSprites(list:ServerFish[]){
    const cvs = pondRef.current!; const W = cvs.clientWidth; const H = cvs.clientHeight;
    spritesRef.current = list.map(f=>{
      const img = new Image(); img.src = f.data_url;
      const scale = rnd(.55, 1.1);
      return { id:f.id, img, w:f.w*scale, h:f.h*scale, x:rnd(f.w, W-f.w), y:rnd(40+f.h/2, H-40-f.h/2), angle:rnd(0,Math.PI*2), speed:rnd(22,60), turn:rnd(.8,2.2), caught:false };
    });
  }

  useEffect(()=>{ if(!pondRef.current) return; rebuildSprites(pondFish); },[pondFish]);

  useEffect(()=>{
    const cvs = pondRef.current!;
    setupHiDPI(cvs);
    const ctx = cvs.getContext('2d')!;
    let rafId = 0;
    function frame(ts:number){
      const dt = Math.min(0.033, (ts - lastTs.current)/1000); lastTs.current = ts;
      const W = cvs.clientWidth, H = cvs.clientHeight;
      ctx.clearRect(0,0,W,H);
      for(let i=0;i<6;i++){
        ctx.globalAlpha=.08; ctx.beginPath();
        ctx.arc(rnd(0,W), rnd(0,H), rnd(10,60), 0, Math.PI*2);
        ctx.fillStyle="#9dd0ff"; ctx.fill(); ctx.globalAlpha=1;
      }
      for(const s of spritesRef.current){
        if(!s.caught){
          s.turn -= dt; if(s.turn<=0){ s.angle += rnd(-0.5,0.5); s.turn=rnd(0.6,1.8); }
          s.x += Math.cos(s.angle)*s.speed*dt; s.y += Math.sin(s.angle)*s.speed*dt;
          const margin=30;
          if (s.x<margin || s.x>W-margin || s.y<40+margin || s.y>H-40-margin){
            const cx=W/2, cy=H/2;
            s.angle = Math.atan2(cy-s.y, cx-s.x) + rnd(-0.25,0.25);
          }
        }
        ctx.save(); ctx.translate(s.x,s.y); ctx.rotate(s.angle);
        ctx.drawImage(s.img, -s.w/2, -s.h/2, s.w, s.h); ctx.restore();
      }
      drawHookAndCheck(ctx);
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);
    const onResize = ()=>setupHiDPI(cvs);
    window.addEventListener('resize', onResize);
    return ()=>{ cancelAnimationFrame(rafId); window.removeEventListener('resize', onResize); };
  },[]);

  function drawHookAndCheck(ctx:CanvasRenderingContext2D){
    const f = fishingRef.current; if(!f.hasHook) return;
    const size = HOOK_SIZE, eyeY = f.y - size;
    ctx.save();
    ctx.strokeStyle="#c7e8ff"; ctx.lineWidth=2; ctx.globalAlpha=.9;
    ctx.beginPath(); ctx.moveTo(f.x,0); ctx.lineTo(f.x, Math.max(0, eyeY)); ctx.stroke();
    ctx.restore();
    drawHookIcon(ctx, f.x, f.y, size);
    if (!f.caughtId){
      for(const s of spritesRef.current){
        const mx = s.x + Math.cos(s.angle)*(s.w*0.52);
        const my = s.y + Math.sin(s.angle)*(s.h*0.18);
        const d = Math.hypot(mx - f.x, my - f.y);
        if (d <= f.biteRadius){
          s.caught = true; s.x = f.x; s.y = f.y;
          f.caughtId = s.id;
          break;
        }
      }
    }else{
      const s = spritesRef.current.find(x=>x.id===f.caughtId);
      if(s){ s.x = f.x + Math.sin(performance.now()/120)*1.2; s.y = f.y + Math.cos(performance.now()/150)*1.2; }
    }
  }

  function armToggle(){ setArmed(a=>!a); }
  function onPondClick(e:React.MouseEvent<HTMLCanvasElement>){
    if(!armed) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    fishingRef.current = { ...fishingRef.current, hasHook:true, x:e.clientX-rect.left, y:e.clientY-rect.top, caughtId:null };
    setArmed(false);
  }
  async function reelUp(){
    const f = fishingRef.current;
    if(!f.hasHook) return;
    if(f.caughtId){
      const res = await fetch('/api/catch', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ fishId:f.caughtId }) });
      if(res.ok){
        spritesRef.current = spritesRef.current.filter(s=>s.id!==f.caughtId);
        setPondFish(prev=>prev.filter(x=>x.id!==f.caughtId));
        setMyCatchCount(n=>n+1);
        alert('收到一条鱼，已加入你的收获！');
      }else{
        alert('这条鱼已被别人抢先钓走了 :(');
        refreshAll();
      }
    }
    fishingRef.current.hasHook=false; fishingRef.current.caughtId=null;
  }

  // ===== 修复 TS: drawCanvasRef.current 可能为 null =====
  useEffect(()=>{
    const el = drawCanvasRef.current;
    if (!el) return;
    const cvs = el as HTMLCanvasElement; // 在闭包顶部收窄为非空

    setupHiDPI(cvs, 420, 240);
    const ctx = cvs.getContext('2d')!;
    let drawing=false; let last:{x:number,y:number}|null=null;
    let strokes:{points:{x:number,y:number}[], color:string, size:number}[]=[];
    (cvs as any)._strokes = strokes;

    function drawGuides(){
      ctx.setTransform(devicePixelRatio||1,0,0,devicePixelRatio||1,0,0);
      ctx.clearRect(0,0,420,240);
      ctx.save();
      ctx.setLineDash([6,6]); ctx.strokeStyle="rgba(255,255,255,.10)"; ctx.strokeRect(2,2,416,236);
      ctx.setLineDash([]);
      const y=22; ctx.lineWidth=2; ctx.strokeStyle="rgba(255,255,255,.6)";
      ctx.beginPath(); ctx.moveTo(20,y); ctx.lineTo(120,y); ctx.lineTo(110,y-8); ctx.moveTo(120,y); ctx.lineTo(110,y+8); ctx.stroke();
      ctx.fillStyle="rgba(255,255,255,.85)"; ctx.font="12px system-ui"; ctx.fillText("鱼头朝右 →", 130, y+4);
      ctx.restore();
      for(const s of strokes){ strokePath(ctx,s.points,s.color,s.size); }
    }
    drawGuides();

    function pos(ev:PointerEvent){
      const r=cvs.getBoundingClientRect();
      const sx=cvs.width/(devicePixelRatio||1)/r.width;
      const sy=cvs.height/(devicePixelRatio||1)/r.height;
      return { x:(ev.clientX-r.left)*sx, y:(ev.clientY-r.top)*sy };
    }
    function down(ev:PointerEvent){ drawing=true; last=pos(ev); strokes.push({points:[last], color:currentColor, size:brush}); strokePath(ctx,[last],currentColor,brush);  }
    function move(ev:PointerEvent){ if(!drawing||!last) return; const p=pos(ev); const s=strokes[strokes.length-1]; s.points.push(p); strokePath(ctx,[last,p], s.color, s.size); last=p; }
    function up(){ drawing=false; last=null; }
    function strokePath(ctx:CanvasRenderingContext2D, points:{x:number,y:number}[], col:string, size:number){
      ctx.strokeStyle=col; ctx.lineWidth=size; ctx.lineCap="round"; ctx.lineJoin="round"; ctx.beginPath();
      for(let i=0;i<points.length;i++){ const p=points[i]; if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); }
      ctx.stroke();
    }

    cvs.addEventListener('pointerdown', down); 
    window.addEventListener('pointermove', move); 
    window.addEventListener('pointerup', up);
    (cvs as any).redraw = drawGuides;
    return ()=>{ 
      cvs.removeEventListener('pointerdown', down); 
      window.removeEventListener('pointermove', move); 
      window.removeEventListener('pointerup', up); 
    };
  },[brush,currentColor]);

  function clearDrawing(){
    const cvs = drawCanvasRef.current!; (cvs as any)._strokes = []; (cvs as any).redraw();
  }
  function undoDrawing(){
    const cvs = drawCanvasRef.current!; const strokes = (cvs as any)._strokes as any[]; if(strokes.length){ strokes.pop(); (cvs as any).redraw(); }
  }
  async function saveFish(){
    const cvs = drawCanvasRef.current!;
    const strokes = (cvs as any)._strokes as any[];
    if(!strokes.length){ alert('先画一条鱼 🙂'); return; }
    const off = document.createElement('canvas'); off.width=420; off.height=240; const g = off.getContext('2d')!;
    for(const s of strokes){
      g.strokeStyle=s.color; g.lineWidth=s.size; g.lineCap='round'; g.lineJoin='round'; g.beginPath();
      for(let i=0;i<s.points.length;i++){ const p=s.points[i]; if(i===0) g.moveTo(p.x,p.y); else g.lineTo(p.x,p.y); } g.stroke();
    }
    const data_url = off.toDataURL('image/png');
    const name = fishName.trim() || `无名鱼-${String(Date.now()).slice(-5)}`;
    const res = await fetch('/api/fish',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name, data_url, w:420, h:240 })});
    if(res.ok){
      (drawDlgRef.current as HTMLDialogElement).close();
      setFishName(''); clearDrawing();
      refreshAll();
    }else{
      alert('保存失败');
    }
  }

  const pondCount = pondFish.length;

  return (
    <div>
      <header style={{display:'flex',gap:8,alignItems:'center',padding:8,borderBottom:'1px solid rgba(255,255,255,.08)'}}>
        <button className="ghost" onClick={()=>drawDlgRef.current?.showModal()}>🎨 画鱼</button>
        <button className="ghost" onClick={armToggle}>{armed ? '✅ 点击池塘放下鱼钩' : '🎯 放下鱼钩'}</button>
        <button className="ghost" onClick={reelUp}>⏫ 收回鱼钩</button>
        <span style={{marginLeft:'auto'}} className="muted">池塘 {pondCount} | 我的收获 {myCatchCount}</span>
      </header>
      <div style={{position:'relative',height:'70dvh'}}>
        <canvas ref={pondRef} onClick={onPondClick} style={{width:'100%',height:'100%',display:'block'}} />
        {armed && <div style={{position:'absolute',top:10,left:'50%',transform:'translateX(-50%)',padding:'4px 8px',border:'1px solid rgba(255,255,255,.2)',borderRadius:999,background:'rgba(0,0,0,.35)'}}>点击池塘任意位置放下鱼钩</div>}
      </div>

      <dialog ref={drawDlgRef} style={{border:'1px solid rgba(255,255,255,.12)',borderRadius:14,background:'linear-gradient(180deg,#0f2236,#0d1e2f)',color:'#cfeaff',width:'min(940px,95vw)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 12px',borderBottom:'1px solid rgba(255,255,255,.08)'}}>
          <strong>🎨 画一条鱼（鱼头朝右）</strong>
          <div style={{display:'flex',gap:8}}>
            <button className="ghost" onClick={clearDrawing}>清空</button>
            <button className="ghost" onClick={undoDrawing}>撤销</button>
            <button className="ghost" onClick={saveFish}>保存到池塘</button>
            <button className="ghost" onClick={()=>drawDlgRef.current?.close()}>关闭</button>
          </div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 260px',gap:12,padding:12}}>
          <canvas ref={drawCanvasRef} style={{width:'100%',height:420,background:'#0b1623',border:'1px solid rgba(255,255,255,.12)',borderRadius:8}} />
          <div style={{display:'grid',gap:10}}>
            <input value={fishName} onChange={e=>setFishName(e.target.value)} placeholder="给这条鱼起个名字" />
            <label>粗细 <input type="range" min={2} max={30} step={1} value={brush} onChange={e=>setBrush(Number(e.target.value))} /></label>
            <div>
              <div className="muted" style={{marginBottom:6}}>颜色</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,28px)',gap:6}}>
                {palette.map(c=>(
                  <button key={c} onClick={()=>setCurrentColor(c)} title={c} style={{width:28,height:28,borderRadius:8,border:`2px solid ${currentColor===c?'#fff':'rgba(255,255,255,.25)'}`,background:c}} />
                ))}
              </div>
            </div>
            <div className="muted">提示：画时顶部箭头仅作参考，导出不会包含。</div>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function rnd(min:number,max:number){ return Math.random()*(max-min)+min; }

function setupHiDPI(canvas:HTMLCanvasElement, w?:number, h?:number){
  function resize(){
    const dpr = Math.max(1, (window.devicePixelRatio||1));
    const rect = canvas.getBoundingClientRect();
    const cssW = w || Math.floor(rect.width);
    const cssH = h || Math.floor(rect.height || 400);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  resize(); window.addEventListener('resize', resize);
}