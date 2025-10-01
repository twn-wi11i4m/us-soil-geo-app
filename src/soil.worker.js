import { getSoilPolygonsAndAreas } from "./workers/soil.js";

let currentAbort = null;

self.addEventListener("message", async (ev) => {
  const msg = ev.data || {};
  console.log("Worker received message:", msg.type, msg.id);

  if (msg.type === "start") {
    const { id, geojson, options = {} } = msg;
    console.log("Worker processing geojson:", geojson ? geojson.type : "null");

    try {
      const controller = new AbortController();
      currentAbort = controller;

      const results = await getSoilPolygonsAndAreas(
        geojson,
        options.maxResults,
        options.debug || false,
        options.normalizeToBoundary || false,
        controller.signal,
        (progress) => {
          self.postMessage({ id, type: "progress", progress });
        }
      );

      currentAbort = null;
      self.postMessage({ id, type: "result", results });
    } catch (err) {
      const aborted = err && err.name === "AbortError";
      self.postMessage({
        id: msg.id,
        type: "error",
        aborted,
        error: err?.message || String(err),
      });
    }
  } else if (msg.type === "abort") {
    try {
      if (currentAbort) currentAbort.abort();
    } catch (e) {
      /* ignore */
    }
  }
});