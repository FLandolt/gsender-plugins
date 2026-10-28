import { useEffect, useRef } from "react";

import { maskPixels, type Gray } from "./lib/image";

/** What the threshold picks: black is carved, white is left. Redrawn live as the slider moves. */
const MaskPreview = ({ gray, threshold, invert }: { gray: Gray; threshold: number; invert: boolean }) => {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		canvas.width = gray.w;
		canvas.height = gray.h;
		ctx.putImageData(new ImageData(maskPixels(gray, threshold, invert) as unknown as Uint8ClampedArray<ArrayBuffer>, gray.w, gray.h), 0, 0);
	}, [gray, threshold, invert]);
	return <canvas ref={ref} className="h-auto max-h-48 w-full rounded-lg border border-gray-300 bg-white object-contain dark:border-slate-600" aria-label="Black areas will be carved" />;
};

export default MaskPreview;
