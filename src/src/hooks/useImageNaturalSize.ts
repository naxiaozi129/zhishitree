import { useEffect, useState } from 'react';

export function useImageNaturalSize(uri: string | null | undefined): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!uri) {
      setSize(null);
      return;
    }
    let cancelled = false;
    const img = new window.Image();
    img.onload = () => {
      if (!cancelled && img.width > 0 && img.height > 0) {
        setSize({ w: img.width, h: img.height });
      }
    };
    img.onerror = () => {
      if (!cancelled) setSize(null);
    };
    img.src = uri;
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return size;
}

export function useViewportHeight(): number {
  const [h, setH] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight : 800,
  );

  useEffect(() => {
    const onResize = () => setH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return h;
}
