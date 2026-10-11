import gsenderPlugin from "@sienci/gsender-plugin-sdk/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), gsenderPlugin(), tailwindcss()],
	// Relative base: gSender serves the built plugin from /plugins/<id>/ui/.
	resolve: {
		alias: {
			"@shared": fileURLToPath(new URL("../../packages/shared/src", import.meta.url)),
		},
	},
	base: "./",
	build: {
		outDir: "ui",
		emptyOutDir: true,
	},
});
