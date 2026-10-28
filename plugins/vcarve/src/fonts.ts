/** The fonts that come with the plugin (Latin letters only; all open licences, see the README). */

import bebasUrl from "@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff?url";
import robotoUrl from "@fontsource/roboto/files/roboto-latin-700-normal.woff?url";
import slabUrl from "@fontsource/roboto-slab/files/roboto-slab-latin-700-normal.woff?url";
import type opentype from "opentype.js";

import { parseFont } from "./lib/text";

export const FONTS = [
	{ id: "roboto-bold", label: "Roboto Bold", note: "Clean sans-serif", url: robotoUrl },
	{ id: "roboto-slab-bold", label: "Roboto Slab Bold", note: "Slab serif", url: slabUrl },
	{ id: "bebas-neue", label: "Bebas Neue", note: "Tall and narrow capitals", url: bebasUrl },
];

const cache = new Map<string, Promise<opentype.Font>>();

export const loadBundledFont = (id: string): Promise<opentype.Font> => {
	const font = FONTS.find((f) => f.id === id) ?? FONTS[0];
	let p = cache.get(font.id);
	if (!p) {
		p = fetch(font.url)
			.then((r) => {
				if (!r.ok) throw new Error(`Couldn't load the font (${r.status}).`);
				return r.arrayBuffer();
			})
			.then(parseFont);
		// Don't cache a failure: try again next time.
		p.catch(() => cache.delete(font.id));
		cache.set(font.id, p);
	}
	return p;
};
