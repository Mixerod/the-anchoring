/**
 * FNV-1a, 64-bit — the one hash in this repository.
 *
 * Three modules grew their own byte-identical copy of this loop before it was extracted:
 * `guardsHash`, `upstreamHash`, and `packHash`. That is not a style problem. A hash is a
 * contract with files already written to disk — a generated header, a pack manifest, a
 * fingerprint stored between runs — and three copies of a contract are three places for it
 * to drift while every local test still passes.
 *
 * Dependency-free on purpose: `node:crypto` is on the pure layer's forbidden-import list,
 * and reaching for it here would push hashing out of the domain and into infra, where the
 * callers cannot follow.
 *
 * Pure module: no filesystem, no crypto, no clock.
 */

const OFFSET_BASIS = 0xcbf29ce484222325n
const PRIME = 0x100000001b3n
const MASK = 0xffffffffffffffffn

/** Hex, always 16 characters, so a stored hash is a fixed-width field. */
export function fnv1a(str: string): string {
  let hash = OFFSET_BASIS
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i))
    hash = (hash * PRIME) & MASK
  }
  return hash.toString(16).padStart(16, '0')
}
