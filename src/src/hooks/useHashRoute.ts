import { useCallback, useEffect, useState } from 'react';

export type HashQuery = Record<string, string>;

function parseHash(): { path: string; query: HashQuery } {
  const raw = (window.location.hash || '').replace(/^#/, '').replace(/^\//, '');
  if (!raw) return { path: 'home', query: {} };
  const [pathPart, search] = raw.split('?');
  const seg = pathPart.split('/')[0] || 'home';
  const path = seg === 'app' ? 'entry' : seg;
  const query: HashQuery = {};
  if (search) {
    new URLSearchParams(search).forEach((v, k) => {
      query[k] = v;
    });
  }
  return { path, query };
}

export function useHashRoute() {
  const [route, setRouteState] = useState(() =>
    typeof window !== 'undefined' ? parseHash() : { path: 'home', query: {} },
  );

  const setPath = useCallback((next: string, query?: Record<string, string | number>) => {
    const normalized = next === 'app' ? 'entry' : next;
    let h = normalized === 'home' ? '' : `#/${normalized}`;
    if (query && Object.keys(query).length > 0) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        qs.set(k, String(v));
      }
      h += `?${qs.toString()}`;
    }
    if (window.location.hash !== h) {
      window.location.hash = h;
    } else {
      setRouteState({
        path: normalized === 'home' ? 'home' : normalized,
        query: query
          ? Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)]))
          : {},
      });
    }
  }, []);

  useEffect(() => {
    const onHash = () => setRouteState(parseHash());
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return { path: route.path, query: route.query, setPath };
}
