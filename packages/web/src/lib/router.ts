import { useEffect, useState } from 'react';

export type Route =
  | { name: 'setup' }
  | { name: 'projects' }
  | { name: 'project'; id: string };

function parse(hash: string): Route {
  const clean = hash.replace(/^#\/?/, '');
  if (clean.startsWith('proyecto/')) {
    const id = clean.slice('proyecto/'.length);
    if (id) return { name: 'project', id };
  }
  if (clean === 'proyectos') return { name: 'projects' };
  return { name: 'setup' };
}

export function toPath(route: Route): string {
  switch (route.name) {
    case 'project':
      return `#/proyecto/${route.id}`;
    case 'projects':
      return '#/proyectos';
    default:
      return '#/';
  }
}

export function navigate(route: Route): void {
  window.location.hash = toPath(route);
}

/** Minimal hash router — the studio only has three screens. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
