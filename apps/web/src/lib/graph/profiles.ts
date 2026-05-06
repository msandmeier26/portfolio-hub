/**
 * Random-graph generator profiles.
 *
 * The user can pick one of the built-in profiles or save their own. Custom
 * profiles are persisted to localStorage so they survive reloads. Nothing
 * leaves the device.
 */

export type RandomGraphProfile = {
  id: string;
  name: string;
  vertexMin: number;
  vertexMax: number;
  /** Target edges = round(vertexCount * edgeFactor). */
  edgeFactor: number;
  allowSelfLoops: boolean;
  builtIn?: boolean;
};

export const BUILTIN_PROFILES: RandomGraphProfile[] = [
  { id: "builtin:tiny",    name: "Tiny",    builtIn: true, vertexMin: 3,  vertexMax: 5,  edgeFactor: 1.0, allowSelfLoops: false },
  { id: "builtin:sparse",  name: "Sparse",  builtIn: true, vertexMin: 5,  vertexMax: 9,  edgeFactor: 0.8, allowSelfLoops: false },
  { id: "builtin:default", name: "Default", builtIn: true, vertexMin: 5,  vertexMax: 9,  edgeFactor: 1.4, allowSelfLoops: false },
  { id: "builtin:dense",   name: "Dense",   builtIn: true, vertexMin: 5,  vertexMax: 9,  edgeFactor: 2.5, allowSelfLoops: false },
  { id: "builtin:big",     name: "Big",     builtIn: true, vertexMin: 10, vertexMax: 15, edgeFactor: 1.5, allowSelfLoops: false },
];

const CUSTOM_KEY = "portfolio.graph.randomProfiles.v1";
const LAST_KEY = "portfolio.graph.randomProfiles.last";

function isProfile(p: unknown): p is RandomGraphProfile {
  if (!p || typeof p !== "object") return false;
  const o = p as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.name === "string" &&
    typeof o.vertexMin === "number" &&
    typeof o.vertexMax === "number" &&
    typeof o.edgeFactor === "number" &&
    typeof o.allowSelfLoops === "boolean"
  );
}

export function loadCustomProfiles(): RandomGraphProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isProfile).map((p) => ({ ...p, builtIn: false }));
  } catch {
    return [];
  }
}

export function saveCustomProfiles(profiles: RandomGraphProfile[]): void {
  if (typeof window === "undefined") return;
  const sanitized = profiles
    .filter((p) => !p.builtIn)
    .map(({ id, name, vertexMin, vertexMax, edgeFactor, allowSelfLoops }) => ({
      id, name, vertexMin, vertexMax, edgeFactor, allowSelfLoops,
    }));
  window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(sanitized));
}

export function loadLastProfileId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_KEY);
}

export function saveLastProfileId(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_KEY, id);
}

export function newProfileId(): string {
  return `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Clamp/normalize editor inputs into a usable profile shape. */
export function normalize(p: RandomGraphProfile): RandomGraphProfile {
  const vMin = Math.max(0, Math.floor(p.vertexMin));
  const vMax = Math.max(vMin, Math.floor(p.vertexMax));
  const factor = Math.max(0, Math.min(10, p.edgeFactor));
  return { ...p, vertexMin: vMin, vertexMax: vMax, edgeFactor: Number(factor.toFixed(2)) };
}
