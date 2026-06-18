import { useCallback, useEffect, useState } from 'react';

function parseHash(): string {
  const raw = (window.location.hash || '').replace(/^#/, '').replace(/^\//, '');
  if (!raw) return 'home';
  const seg = raw.split('/')[0] || 'home';
  if (seg === 'app') return 'entry';
  return seg;
}

export function useHashRoute() {
  const [path, setPathState] = useState<string>(() => (typeof window !== 'undefined' ? parseHash() : 'home'));

  const setPath = useCallback((next: string) => {
    const normalized = next === 'app' ? 'entry' : next;
    const h = normalized === 'home' ? '' : `#/${normalized}`;
    if (window.location.hash !== h) {
      window.location.hash = h;
    } else {
      setPathState(normalized === 'home' ? 'home' : normalized);
    }
  }, []);

  useEffect(() => {
    const onHash = () => setPathState(parseHash());
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return { path, setPath };
}
