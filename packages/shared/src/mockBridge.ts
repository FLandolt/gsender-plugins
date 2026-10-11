/**
 * Standalone development harness.
 *
 * The SDK talks to gSender by posting messages to `window.parent`. Run outside
 * gSender and `window.parent === window`, so nothing ever answers and every
 * bridge promise hangs forever.
 *
 * Rather than stubbing the SDK — which would mean the harness exercises
 * different code than production — this installs a listener that speaks the
 * real protocol back to it. The SDK itself runs completely unmodified; only the
 * thing on the other end of the channel changes.
 */

import {
	PLUGIN_BRIDGE_CHANNEL,
	type PluginBridgeRequest,
} from "@sienci/gsender-plugin-sdk";

/** Stand-in for gSender's workspace slice — just enough for units. */
const mockWorkspace = {
	units: "mm",
	mode: "standalone-harness",
};

const mockRedux = {
	connection: { isConnected: false, port: null },
	controller: { type: "grbl", state: {} },
	workspace: mockWorkspace,
};

const download = (contents: string, name: string) => {
	const blob = new Blob([contents], { type: "text/plain" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = name;
	anchor.click();
	URL.revokeObjectURL(url);
};

const handle = (
	request: PluginBridgeRequest,
): { ok: true; result: unknown } | { ok: false; error: string } => {
	switch (request.type) {
		case "workspace:get:state":
			return { ok: true, result: mockWorkspace };
		case "redux:get:state":
			return { ok: true, result: mockRedux };
		case "machine:get:context":
			return { ok: true, result: { controllerType: "grbl", connected: false } };
		case "machine:command":
			console.info("[harness] machine command", request.payload);
			return { ok: true, result: null };
		case "gcode:load:to:visualizer": {
			const { gcode, name } = (request.payload ?? {}) as {
				gcode?: string;
				name?: string;
			};
			const filename = name || "program.nc";
			console.info(`[harness] loadToVisualizer → downloading ${filename}`);
			download(gcode ?? "", filename);
			return { ok: true, result: { name: filename } };
		}
		default:
			return { ok: false, error: `Unhandled bridge request: ${request.type}` };
	}
};

let installed = false;

export const installMockBridge = (): void => {
	if (installed) return;
	installed = true;

	const subscriptions = new Map<string, string>();

	window.addEventListener("message", (event: MessageEvent) => {
		const data = event.data;
		if (!data || data.channel !== PLUGIN_BRIDGE_CHANNEL) return;

		if (data.request) {
			const request = data.request as PluginBridgeRequest;
			const outcome = handle(request);
			window.postMessage(
				{
					channel: PLUGIN_BRIDGE_CHANNEL,
					response: { id: request.id, ...outcome },
				},
				"*",
			);
			return;
		}

		if (data.subscribe) {
			const { id, topic } = data.subscribe as { id: string; topic: string };
			subscriptions.set(id, topic);
			// The SDK expects an immediate snapshot on subscribe.
			window.postMessage(
				{
					channel: PLUGIN_BRIDGE_CHANNEL,
					update: {
						topic,
						snapshot: topic === "workspace" ? mockWorkspace : mockRedux,
					},
				},
				"*",
			);
			return;
		}

		if (data.unsubscribe) {
			subscriptions.delete((data.unsubscribe as { id: string }).id);
		}
	});

	console.info(
		"[harness] Plugin running standalone — gSender bridge is mocked. " +
			"'Load to gSender' will download the .nc file instead.",
	);
};

/** True when running outside a gSender plugin iframe. */
export const isStandalone = (): boolean => window.parent === window;
