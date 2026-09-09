import { useEffect, useRef } from 'react';

const colors = ['#f1f5ff', '#aacdff', '#d3bdff', '#ffe2b7'];

export function StarVortex() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d', { alpha: false });
    if (!element || !context) return;

    const stars = Array.from({ length: 700 }, (_, index) => ({
      depth: Math.random(),
      angle: (index % 3) * ((Math.PI * 2) / 3) + (Math.random() - 0.5) * 0.65,
      size: 0.4 + Math.random() ** 2 * 1.8,
      speed: 0.018 + Math.random() * 0.008,
      color: colors[index % colors.length],
    }));
    const background = Array.from({ length: 130 }, () => ({
      x: Math.random(),
      y: Math.random(),
      size: 0.3 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
    }));
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let frame = 0;
    let previous = 0;
    let time = 0;

    function draw() {
      if (!context) return;
      context.globalAlpha = 1;
      context.fillStyle = '#000';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#b7caff';
      for (const star of background) {
        context.globalAlpha = 0.2 + 0.2 * (1 + Math.sin(time * 0.4 + star.phase));
        context.beginPath();
        context.arc(star.x * width, star.y * height, star.size, 0, Math.PI * 2);
        context.fill();
      }

      const radius = Math.min(width * 0.48, height * 0.7);
      context.save();
      context.translate(width / 2, height / 2);
      context.rotate(-0.2);
      context.scale(1, 0.72);
      const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius * 0.5);
      glow.addColorStop(0, '#accdff24');
      glow.addColorStop(0.18, '#779bff10');
      glow.addColorStop(1, '#00000000');
      context.globalAlpha = 1;
      context.fillStyle = glow;
      context.fillRect(-radius, -radius, radius * 2, radius * 2);

      for (const star of stars) {
        const depth = (((star.depth - time * star.speed) % 1) + 1) % 1;
        const distance = depth ** 1.4 * radius;
        const angle = star.angle + (1 - depth) * 6 + time * 0.12;
        const x = Math.cos(angle) * distance;
        const y = Math.sin(angle) * distance;
        context.globalAlpha = Math.min(depth * 15, (1 - depth) * 8, 1) * 0.85;
        context.strokeStyle = star.color;
        context.lineWidth = star.size * 0.65;
        context.beginPath();
        context.arc(0, 0, distance, angle - 0.025, angle);
        context.stroke();
        context.fillStyle = star.color;
        context.beginPath();
        context.arc(x, y, star.size, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }

    function animate(now: number) {
      if (previous) time += Math.min((now - previous) / 1000, 0.05);
      previous = now;
      draw();
      frame = requestAnimationFrame(animate);
    }

    function resume() {
      cancelAnimationFrame(frame);
      previous = 0;
      draw();
      if (!document.hidden && !reducedMotion.matches) {
        frame = requestAnimationFrame(animate);
      }
    }

    function resize() {
      if (!element || !context) return;
      width = window.innerWidth;
      height = window.innerHeight;
      // Keep the idle screen inexpensive even on a Retina / 4K display.
      const ratio = Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(3_000_000 / (width * height)));
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    }

    resize();
    resume();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', resume);
    reducedMotion.addEventListener('change', resume);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', resume);
      reducedMotion.removeEventListener('change', resume);
    };
  }, []);

  return <canvas ref={canvas} className="star-vortex" aria-hidden="true" />;
}
