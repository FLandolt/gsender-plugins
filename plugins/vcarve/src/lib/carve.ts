/**
 * From shapes to a V-carve toolpath: the bit follows the centre line of each shape, going
 * deeper where the shape is wider.
 *
 * Safety first: no point of the result is ever deeper than `maxDepth` (clamped at the very
 * end whatever else happened), and shapes too wide for the bit at that depth are reported
 * with where they are and by how much, rather than quietly cut wrong.
 */

import { depthForRadius, deepestCut, type Bit } from "./bit";
import { ringLength, simplifyOpen3, type Shape } from "./geom";
import { medialAxis, type Axis } from "./medial";
import type { Quality } from "./params";

export type P3 = { x: number; y: number; z: number };

/** A spot where the shape is wider than the bit can cut at the allowed depth. */
export type Place = { x: number; y: number; need: number; width: number };

/** A narrow part of the artwork, thinner than the bit's tip. */
export type Thin = { x: number; y: number; width: number };

export type CarvePlan = {
	/**
	 * The cuts in the order to make them, in artwork coordinates; every z is at most 0. With
	 * roughing, the roughing cuts come first and the finishing cuts after them.
	 */
	chains: P3[][];
	/** How many of the chains are roughing and how many finishing, and what the roughing leaves; null without roughing. */
	passes: { roughing: number; finishing: number; allowance: number } | null;
	/** The deepest cut the artwork needs, with no limit. */
	deepestNeeded: number;
	/** The deepest the bit can cut. */
	deepestBit: number;
	maxDepth: number;
	tooWide: Place[];
	thin: Thin[];
	/** Some of the cut was held at the maximum depth. */
	capped: boolean;
	cutLength: number;
	/** The outline sampling had to be made coarser than the quality asked for, to keep it fast. */
	qualityReduced: boolean;
};

export const QUALITY: Record<Quality, { spacing: number; tolerance: number }> = {
	draft: { spacing: 0.3, tolerance: 0.05 },
	normal: { spacing: 0.18, tolerance: 0.02 },
	fine: { spacing: 0.1, tolerance: 0.01 },
};

const MAX_SITES = 200_000;

type Chain = {
	pts: P3[];
	/** Axis vertices that join other chains, as `shape:vertex` keys: where this chain may begin or end. */
	nodeKeys: string[];
	startKey: string | null;
	endKey: string | null;
};

/** Splits an axis into branches between junctions and ends. */
const branchesOf = (axis: Axis): number[][] => {
	const n = axis.verts.length;
	const deg = axis.adj.map((a) => a.length);
	const seen = new Set<number>();
	const edge = (a: number, b: number) => (a < b ? a * n + b : b * n + a);
	const out: number[][] = [];
	const walk = (start: number, first: number) => {
		const path = [start, first];
		seen.add(edge(start, first));
		let prev = start, cur = first;
		while (deg[cur] === 2) {
			const next = axis.adj[cur].find((v) => v !== prev && !seen.has(edge(cur, v)));
			if (next === undefined) break;
			seen.add(edge(cur, next));
			path.push(next);
			prev = cur;
			cur = next;
		}
		out.push(path);
	};
	for (let v = 0; v < n; v += 1) {
		if (deg[v] === 0 || deg[v] === 2) continue;
		for (const w of axis.adj[v]) if (!seen.has(edge(v, w))) walk(v, w);
	}
	// What is left are closed loops with no junction on them.
	for (let v = 0; v < n; v += 1) {
		if (deg[v] !== 2) continue;
		for (const w of axis.adj[v]) if (!seen.has(edge(v, w))) walk(v, w);
	}
	return out;
};

/** Joins branches into long smooth chains by pairing, at each junction, the two that continue most nearly straight on. */
const chainsOf = (axis: Axis, branches: number[][]): number[][] => {
	const deg = axis.adj.map((a) => a.length);
	type End = { b: number; e: 0 | 1 };
	const atNode = new Map<number, End[]>();
	branches.forEach((br, b) => {
		if (deg[br[0]] !== 2) (atNode.get(br[0]) ?? atNode.set(br[0], []).get(br[0])!).push({ b, e: 0 });
		if (deg[br[br.length - 1]] !== 2 && br.length > 1) (atNode.get(br[br.length - 1]) ?? atNode.set(br[br.length - 1], []).get(br[br.length - 1])!).push({ b, e: 1 });
	});
	const dir = ({ b, e }: End): [number, number] => {
		const br = e === 0 ? branches[b] : [...branches[b]].reverse();
		const o = axis.verts[br[0]];
		let along = 0;
		for (let i = 1; i < br.length; i += 1) {
			const p = axis.verts[br[i]];
			along = Math.hypot(p.x - o.x, p.y - o.y);
			if (along >= 0.6 || i === br.length - 1) {
				return along > 0 ? [(p.x - o.x) / along, (p.y - o.y) / along] : [0, 0];
			}
		}
		return [0, 0];
	};
	const partner = new Map<string, End>();
	const key = (x: End) => `${x.b}:${x.e}`;
	const MAX_TURN = (100 * Math.PI) / 180;
	for (const ends of atNode.values()) {
		if (ends.length < 2) continue;
		const pairs: { a: End; b: End; turn: number }[] = [];
		for (let i = 0; i < ends.length; i += 1) for (let j = i + 1; j < ends.length; j += 1) {
			const da = dir(ends[i]), db = dir(ends[j]);
			// Straight on means the two ends point in opposite directions.
			const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, da[0] * db[0] + da[1] * db[1])));
			if (turn <= MAX_TURN) pairs.push({ a: ends[i], b: ends[j], turn });
		}
		pairs.sort((p, q) => p.turn - q.turn);
		const used = new Set<string>();
		for (const { a, b } of pairs) {
			if (used.has(key(a)) || used.has(key(b)) || (a.b === b.b && a.e === b.e)) continue;
			used.add(key(a));
			used.add(key(b));
			partner.set(key(a), b);
			partner.set(key(b), a);
		}
	}
	const done = new Array<boolean>(branches.length).fill(false);
	const chains: number[][] = [];
	const follow = (b0: number, e0: 0 | 1) => {
		const chain: number[] = [];
		let b = b0, enter = e0;
		for (;;) {
			done[b] = true;
			const br = enter === 0 ? branches[b] : [...branches[b]].reverse();
			chain.push(...(chain.length ? br.slice(1) : br));
			const next = partner.get(key({ b, e: enter === 0 ? 1 : 0 }));
			if (!next || done[next.b]) break;
			b = next.b;
			enter = next.e;
		}
		chains.push(chain);
	};
	// Chains start where a branch has no partner at one end.
	branches.forEach((_, b) => {
		if (done[b]) return;
		if (!partner.has(key({ b, e: 0 }))) follow(b, 0);
		else if (!partner.has(key({ b, e: 1 }))) follow(b, 1);
	});
	// Anything left is a loop of branches, or a closed ring.
	branches.forEach((br, b) => {
		if (!done[b]) {
			// A closed ring: begin at its shallowest point.
			if (br[0] === br[br.length - 1] && br.length > 3) {
				const ring = br.slice(0, -1);
				let at = 0;
				ring.forEach((v, i) => {
					if (axis.verts[v].r < axis.verts[ring[at]].r) at = i;
				});
				chains.push([...ring.slice(at), ...ring.slice(0, at), ring[at]]);
				done[b] = true;
			} else follow(b, 0);
		}
	});
	return chains;
};

type ShapeResult = { chains: Chain[]; rough: Chain[]; need: number; tooWide: Place[]; thin: Thin[]; capped: boolean };

const planShape = (shape: Shape, shapeIndex: number, bit: Bit, maxDepth: number, spacing: number, tol: number, allowance: number | null): ShapeResult => {
	const axis = medialAxis(shape, spacing);
	const deg = axis.adj.map((a) => a.length);
	const needAt = axis.verts.map((v) => depthForRadius(v.r, bit));
	const result: ShapeResult = { chains: [], rough: [], need: Math.max(0, ...needAt), tooWide: [], thin: [], capped: needAt.some((d) => d > maxDepth + 1e-9) };

	// Places the shape is too wide: connected stretches of the centre line that need too much depth.
	const seen = new Set<number>();
	needAt.forEach((d, start) => {
		if (d <= maxDepth + 1e-9 || seen.has(start)) return;
		let worst = start;
		const queue = [start];
		seen.add(start);
		while (queue.length) {
			const v = queue.pop()!;
			if (needAt[v] > needAt[worst]) worst = v;
			for (const w of axis.adj[v]) if (!seen.has(w) && needAt[w] > maxDepth + 1e-9) {
				seen.add(w);
				queue.push(w);
			}
		}
		result.tooWide.push({ x: axis.verts[worst].x, y: axis.verts[worst].y, need: needAt[worst], width: 2 * axis.verts[worst].r });
	});

	const branches = branchesOf(axis);
	// Parts narrower than the tip can't be cut to a point.
	if (bit.tip > 0) {
		for (const br of branches) {
			const rs = br.map((v) => axis.verts[v].r);
			const length = br.reduce((s, v, i) => (i ? s + Math.hypot(axis.verts[v].x - axis.verts[br[i - 1]].x, axis.verts[v].y - axis.verts[br[i - 1]].y) : 0), 0);
			if (Math.max(...rs) < bit.tip / 2 - 1e-9 && length >= 0.5) {
				const mid = axis.verts[br[Math.floor(br.length / 2)]];
				result.thin.push({ x: mid.x, y: mid.y, width: 2 * Math.max(...rs) });
			}
		}
	}

	const keyOf = (v: number) => `${shapeIndex}:${v}`;
	const chainIds = chainsOf(axis, branches);
	/** The cuts for one pass, given how deep each point of the centre line goes in it. */
	const build = (need: number[]): Chain[] => {
		const out: Chain[] = [];
		// A shape that is round at its widest, such as a disc, has a single point for a centre line: a plunge.
		axis.verts.forEach((v, id) => {
			if (deg[id] !== 0 || need[id] <= 1e-9) return;
			out.push({ pts: [{ x: v.x, y: v.y, z: -Math.min(need[id], maxDepth) }], nodeKeys: [], startKey: null, endKey: null });
		});
		for (const ids of chainIds) {
			let pts: (P3 & { id: number })[] = ids.map((id) => ({
				x: axis.verts[id].x,
				y: axis.verts[id].y,
				z: -Math.min(need[id], maxDepth),
				id,
			}));
			// Nothing to cut where the bit's tip is wider than the part.
			const first = pts.findIndex((p) => p.z < -1e-9);
			if (first < 0) continue;
			const last = pts.length - 1 - [...pts].reverse().findIndex((p) => p.z < -1e-9);
			// Keep the point at the surface just before the cut begins: that is where it tapers to a point.
			pts = pts.slice(Math.max(0, first - 1), Math.min(pts.length, last + 2));
			const keep = new Set<number>();
			pts.forEach((p, i) => {
				if (deg[p.id] !== 2) keep.add(i);
			});
			pts = simplifyOpen3(pts, tol, keep);
			const nodes = pts.filter((p) => deg[p.id] !== 2).map((p) => keyOf(p.id));
			out.push({
				pts: pts.map(({ x, y, z }) => ({ x, y, z })),
				nodeKeys: nodes,
				startKey: deg[pts[0].id] !== 2 && deg[pts[0].id] !== 1 ? keyOf(pts[0].id) : null,
				endKey: deg[pts[pts.length - 1].id] !== 2 && deg[pts[pts.length - 1].id] !== 1 ? keyOf(pts[pts.length - 1].id) : null,
			});
		}
		return out;
	};
	result.chains = build(needAt);
	// Roughing: the same centre lines, cut as if every shape were `allowance` narrower on each side, so
	// that much wood is left on the walls for the finishing pass.
	if (allowance !== null) result.rough = build(axis.verts.map((v) => depthForRadius(v.r - allowance, bit)));
	return result;
};

/** Puts the chains in an order with few lifts, never starting a cut in uncut material unless there is no other way. */
const orderChains = (chains: Chain[]): P3[][] => {
	const remaining = [...chains];
	const visited = new Set<string>();
	const out: P3[][] = [];
	let at = { x: 0, y: 0 };
	// Starting on the surface is free (the cut ramps in); starting at a spot already cut is free too.
	const free = (c: Chain, rev: boolean) => {
		const p = rev ? c.pts[c.pts.length - 1] : c.pts[0];
		const key = rev ? c.endKey : c.startKey;
		return p.z > -0.05 || (key !== null && visited.has(key));
	};
	while (remaining.length) {
		let best = -1, bestRev = false, bestCost = Infinity, bestFree = false;
		remaining.forEach((c, i) => {
			for (const rev of [false, true]) {
				const p = rev ? c.pts[c.pts.length - 1] : c.pts[0];
				const isFree = free(c, rev);
				// Free starts always beat plunging into material; among equals the nearest wins.
				const cost = Math.hypot(p.x - at.x, p.y - at.y) + (isFree ? 0 : 1e6 + -p.z * 1e3);
				if (cost < bestCost) {
					bestCost = cost;
					best = i;
					bestRev = rev;
					bestFree = isFree;
				}
			}
		});
		void bestFree;
		const [c] = remaining.splice(best, 1);
		const pts = bestRev ? [...c.pts].reverse() : c.pts;
		out.push(pts);
		for (const k of c.nodeKeys) visited.add(k);
		at = pts[pts.length - 1];
	}
	return out;
};

export type PlanOptions = {
	/** Cut a roughing pass that leaves `allowance` mm on each wall, then a finishing pass. */
	roughing?: { allowance: number };
};

export const planCarve = (shapes: Shape[], bit: Bit, maxDepth: number, quality: Quality, options: PlanOptions = {}): CarvePlan => {
	const q = QUALITY[quality];
	const perimeter = shapes.reduce((s, sh) => s + ringLength(sh.outer) + sh.holes.reduce((t, r) => t + ringLength(r), 0), 0);
	const spacing = Math.max(q.spacing, perimeter / MAX_SITES);
	const allowance = options.roughing ? Math.max(0, options.roughing.allowance) : null;
	const results = shapes.map((s, i) => planShape(s, i, bit, maxDepth, spacing, q.tolerance, allowance));
	const finishing = orderChains(results.flatMap((r) => r.chains));
	const roughing = allowance === null ? [] : orderChains(results.flatMap((r) => r.rough));
	const chains = [...roughing, ...finishing];
	// The last line of defence: nothing is ever below the limit or above the surface.
	for (const c of chains) for (const p of c) p.z = Math.min(0, Math.max(-maxDepth, p.z));
	let cutLength = 0;
	for (const c of chains) for (let i = 1; i < c.length; i += 1) cutLength += Math.hypot(c[i].x - c[i - 1].x, c[i].y - c[i - 1].y, c[i].z - c[i - 1].z);
	return {
		chains,
		passes: allowance === null ? null : { roughing: roughing.length, finishing: finishing.length, allowance },
		deepestNeeded: Math.max(0, ...results.map((r) => r.need)),
		deepestBit: deepestCut(bit).depth,
		maxDepth,
		tooWide: results.flatMap((r) => r.tooWide).sort((a, b) => b.need - a.need),
		thin: results.flatMap((r) => r.thin),
		capped: results.some((r) => r.capped),
		cutLength,
		qualityReduced: spacing > q.spacing + 1e-9,
	};
};
