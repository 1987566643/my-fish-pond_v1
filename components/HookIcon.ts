export const HOOK_SIZE = 30;

export function drawHookIcon(g: CanvasRenderingContext2D, x: number, y: number, size = HOOK_SIZE) {
  g.save();
  g.translate(x, y);

  const grad = g.createLinearGradient(0, 0, 0, -size);
  grad.addColorStop(0, "#d9e9f9");
  grad.addColorStop(1, "#89a9c6");
  g.lineCap = "round";
  g.lineJoin = "round";

  const p = new Path2D();
  p.moveTo(0, 0);
  p.quadraticCurveTo(size*0.42, -size*0.02, size*0.55, -size*0.38);
  p.quadraticCurveTo(size*0.62, -size*0.70, size*0.32, -size*0.98);
  p.lineTo(0, -size);

  g.shadowColor = "rgba(0,0,0,.35)";
  g.shadowBlur = 4;
  g.shadowOffsetY = 1;
  g.strokeStyle = grad;
  g.lineWidth = 2.6;
  g.stroke(p);
  g.shadowColor = "transparent";

  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(size*0.12, -size*0.08);
  g.lineTo(size*0.06, -size*0.20);
  g.closePath();
  g.fillStyle = "#e8f3ff";
  g.fill();

  g.beginPath();
  g.arc(0, -size, size*0.12, 0, Math.PI*2);
  g.fillStyle = "#cfe3fa";
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = "#8fb2d3";
  g.stroke();

  g.restore();
}
