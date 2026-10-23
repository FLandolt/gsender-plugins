import gsenderPlugin from "@sienci/gsender-plugin-sdk/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
	// The website demo has no gSender host to provide the SDK and React, so the
	// "demo" mode skips the plugin that externalises them and bundles everything.
	const demo = mode === "demo";
	return {
		plugins: [react(), ...(demo ? [] : [gsenderPlugin()]), tailwindcss()],
		// Relative base: gSender serves the built plugin from /plugins/<id>/ui/.
		resolve: {
			alias: {
				"@shared": fileURLToPath(new URL("../../packages/shared/src", import.meta.url)),
			},
			dedupe: ["react", "react-dom"],
		},
		base: "./",
		build: {
			outDir: demo ? "ui-demo" : "ui",
			emptyOutDir: true,
		},
	};
});
