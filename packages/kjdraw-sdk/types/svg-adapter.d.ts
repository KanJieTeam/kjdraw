import type { KJFileAdapter } from './file-adapters.js';
/** Write-only physical SVG output. Use exportDrawingSvg to inspect partial export reports. */
export declare function createSVGFileAdapter(): Readonly<KJFileAdapter<never, string>>;
