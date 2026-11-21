import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { installMockBridge, isStandalone } from "@shared/mockBridge";
import "./index.css";

// Outside gSender there is no parent window to answer the bridge, so stand one
// up. Inside gSender this is a no-op and the real host handles everything.
if (isStandalone()) {
	installMockBridge();
}

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root element");

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
