import React, { useEffect, useRef } from 'react';
import { ConnectionState } from '../types';

interface VisualizerProps {
  state: ConnectionState;
  volume: number; // 0 to 1
}

const Visualizer: React.FC<VisualizerProps> = ({ state, volume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    const render = () => {
      time += 0.05;
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Base circle
      let baseRadius = 60;
      let color = '#3b5468'; // Default slate/blue

      if (state === ConnectionState.CONNECTED) {
        color = '#c5a059'; // Gold when connected
        baseRadius = 60 + (volume * 50); // React to volume
      } else if (state === ConnectionState.CONNECTING) {
        color = '#94a3b8'; // Loading gray
        baseRadius = 60 + Math.sin(time * 5) * 5;
      }

      // Draw glow
      const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius * 0.5, centerX, centerY, baseRadius * 1.5);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Draw core
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      // Connecting waves
      if (state === ConnectionState.CONNECTED || state === ConnectionState.CONNECTING) {
         ctx.strokeStyle = 'rgba(255,255,255,0.3)';
         ctx.lineWidth = 2;
         for(let i=1; i<=3; i++) {
             const r = baseRadius + (i * 15 * (Math.sin(time - i) + 1));
             ctx.beginPath();
             ctx.arc(centerX, centerY, r, 0, Math.PI * 2);
             ctx.stroke();
         }
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [state, volume]);

  return (
    <div className="relative flex justify-center items-center h-64 w-full">
      <canvas 
        ref={canvasRef} 
        width={400} 
        height={300} 
        className="max-w-full h-full"
      />
    </div>
  );
};

export default Visualizer;