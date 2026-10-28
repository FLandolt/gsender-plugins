// The tests read the bundled font files straight from node_modules. This is the one Node function they use.
declare module "node:fs" {
	export function readFileSync(path: URL | string): { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
}
