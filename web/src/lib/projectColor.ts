import type { Project } from '@ccui/shared';

export const PROJECT_COLORS = ['#0070f3', '#f5a623', '#50e3c2', '#ff0080', '#7928ca', '#ef4444', '#79ffe1', '#a3e635'];

/** the chosen accent, or a stable pick from the palette so projects created before colors existed still get one */
export function projectColor(p: Pick<Project, 'id' | 'color'>): string {
  if (p.color) return p.color;
  let h = 0;
  for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PROJECT_COLORS[h % PROJECT_COLORS.length];
}
