export function normalizeLabel(label: string): string {
  let s = label.trim().toLowerCase();
  s = stripAcceleratorPrefix(s);
  return s.trim();
}

function stripAcceleratorPrefix(label: string): string {
  const bracketMatch = label.match(/^\[(.)\]\s*/);
  if (bracketMatch) return label.slice(bracketMatch[0].length);
  const parenMatch = label.match(/^(.)\)\s*/);
  if (parenMatch) return label.slice(parenMatch[0].length);
  const dashMatch = label.match(/^(.)\s*-\s*/);
  if (dashMatch) return label.slice(dashMatch[0].length);
  return label;
}

export function parseAcceleratorKey(label: string): string {
  const bracketMatch = label.match(/^\[(.)\]/);
  if (bracketMatch?.[1]) return bracketMatch[1].toUpperCase();
  const parenMatch = label.match(/^(.)\)/);
  if (parenMatch?.[1]) return parenMatch[1].toUpperCase();
  const dashMatch = label.match(/^(.)\s*-\s/);
  if (dashMatch?.[1]) return dashMatch[1].toUpperCase();
  if (label.length > 0) return label[0]!.toUpperCase();
  return "";
}

export function deriveClassName(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
