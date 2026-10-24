// Runs the Tessaract balance harness off the main thread, so the editor stays responsive during a long sim.
import { simulate } from "./engine/tessaract.js";

self.onmessage = ({ data }) => {
  try {
    const report = simulate(data.game, { ...data.opts, onProgress: (done, total) => { if (done % 10 === 0 || done === total) self.postMessage({ progress: done, total }); } });
    self.postMessage({ report });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
