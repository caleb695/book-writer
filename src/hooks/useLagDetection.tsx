import { useState, useEffect, useRef, useCallback } from "react";

export interface LagMetrics {
  fps: number;
  memoryUsageMB: number;
  isLagging: boolean;
}

const FPS_THRESHOLD = 30;
const MEMORY_THRESHOLD_MB = 500;
const CHECK_INTERVAL_MS = 2000;

/**
 * Monitors browser performance using the Performance API.
 * Detects frame drops, high memory usage, and signals when to pause practice.
 */
export function useLagDetection() {
  const [metrics, setMetrics] = useState<LagMetrics>({ fps: 60, memoryUsageMB: 0, isLagging: false });
  const [paused, setPaused] = useState(false);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const rafRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Count frames
  useEffect(() => {
    const countFrame = () => {
      frameCountRef.current++;
      rafRef.current = requestAnimationFrame(countFrame);
    };
    rafRef.current = requestAnimationFrame(countFrame);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Periodic metric check
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      const now = performance.now();
      const elapsed = (now - lastTimeRef.current) / 1000;
      const fps = elapsed > 0 ? Math.round(frameCountRef.current / elapsed) : 60;
      frameCountRef.current = 0;
      lastTimeRef.current = now;

      // Memory (if available)
      let memoryMB = 0;
      if ((performance as any).memory) {
        memoryMB = Math.round((performance as any).memory.usedJSHeapSize / (1024 * 1024));
      }

      const isLagging = fps < FPS_THRESHOLD || memoryMB > MEMORY_THRESHOLD_MB;
      
      setMetrics({ fps, memoryUsageMB: memoryMB, isLagging });
      
      if (isLagging && !paused) {
        setPaused(true);
      } else if (!isLagging && paused) {
        setPaused(false);
      }
    }, CHECK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paused]);

  /** Manually pause (e.g., when user starts real generation) */
  const forcePause = useCallback(() => setPaused(true), []);
  
  /** Resume when generation completes and metrics are ok */
  const forceResume = useCallback(() => {
    if (!metrics.isLagging) setPaused(false);
  }, [metrics.isLagging]);

  return { metrics, paused, forcePause, forceResume };
}
