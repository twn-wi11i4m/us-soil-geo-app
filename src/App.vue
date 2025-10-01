<template>
  <div class="app">
    <!-- Green Header -->
    <header class="app-header">
      <h1>Soil Geo App</h1>
    </header>

    <!-- Main Content: Two Columns -->
    <div class="main-content">
      <!-- Left Column: Map -->
      <div id="left-panel" class="panel left-panel">
        <div id="map" class="map-container"></div>
        <!-- Map Status Indicator -->
        <div v-if="mapStatus" class="map-status" :class="mapStatus.type">
          {{ mapStatus.message }}
        </div>
      </div>

      <!-- Splitter -->
      <div id="splitter" class="splitter"></div>

      <!-- Right Column: Information -->
      <div id="right-panel" class="panel right-panel">
        <!-- Control Panel -->
        <div class="controls">
          <div class="control-group">
            <button
              @click="clearAll"
              class="btn btn-danger"
              :disabled="soilLoading"
            >
              Clear All
            </button>
            <button
              @click="zoomToDrawings"
              class="btn btn-secondary"
              :disabled="!geojson || soilLoading"
            >
              Zoom to Drawings
            </button>
            <button
              @click="downloadGeoJSON"
              class="btn btn-primary"
              :disabled="!geojson || soilLoading"
            >
              Download GeoJSON
            </button>
            <button
              @click="forceRecalculate"
              class="btn btn-warning"
              v-if="geojson && geojson.summary && geojson.summary.features > 0"
              :disabled="soilLoading || !soilData"
            >
              🔄 Recalculate
            </button>
          </div>
        </div>

        <!-- Drawing Basic Info -->
        <div v-if="geoSummary" class="drawing-summary">
          <h3>Drawing Summary</h3>
          <p><strong>Features:</strong> {{ geoSummary.features }}</p>
          <p>
            <strong>Area (acres):</strong>
            {{ geoSummary.area_acres.toFixed(2) }}
          </p>
          <p><strong>Vertices:</strong> {{ geoSummary.vertices }}</p>
        </div>

        <!-- Soil Information Panel -->
        <div class="soil-output">
          <h3>Soil Information</h3>
          <div
            v-if="geojson && geojson.summary && geojson.summary.features > 0"
            class="analysis-status"
          >
            <small class="status-text">
              📍 Analyzing {{ geojson.summary.features }} polygon{{
                geojson.summary.features !== 1 ? "s" : ""
              }}
              ({{ geojson.summary.area_acres.toFixed(2) }} acres)
            </small>
          </div>
          <div class="json-container">
            <!-- Loading State -->
            <div v-if="soilLoading" class="loading-state">
              <p>🌱 {{ soilProgress.message || "Analyzing soil data..." }}</p>
              <div class="progress-bar">
                <div
                  class="progress-fill"
                  :style="{ width: progressPercentage + '%' }"
                ></div>
                <span class="progress-text">
                  {{
                    soilProgress.total > 0
                      ? `${soilProgress.current} / ${soilProgress.total}`
                      : "Initializing..."
                  }}
                </span>
              </div>
            </div>

            <!-- Error State -->
            <div v-else-if="soilError" class="error-state">
              <p>❌ Error loading soil data: {{ soilError }}</p>
            </div>

            <!-- Soil Data Display -->
            <div
              v-else-if="
                soilData && soilData.features && soilData.features.length > 0
              "
              class="soil-data"
            >
              <!-- Summary -->
              <div class="soil-summary">
                <p>
                  <strong
                    >Found {{ soilUnitsArray.length }} soil unit{{
                      soilUnitsArray.length !== 1 ? "s" : ""
                    }}</strong
                  >
                </p>
                <p>
                  <strong>Total Area:</strong>
                  {{ totalSoilAcres.toFixed(2) }} acres
                </p>
                <p v-if="soilElapsedMs !== null">
                  <small
                    >Computed in {{ (soilElapsedMs / 1000).toFixed(2) }}s</small
                  >
                </p>

                <!-- Color Legend -->
                <div class="soil-legend">
                  <h5>Soil Unit Colors on Map:</h5>
                  <div class="legend-items">
                    <div
                      v-for="(unit, index) in soilUnitsArray"
                      :key="unit.mukey"
                      class="legend-item"
                    >
                      <div
                        class="legend-color"
                        :style="{ backgroundColor: getSoilColor(index) }"
                      ></div>
                      <span class="legend-text">{{
                        unit.muname || `Unit ${unit.mukey}`
                      }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Soil Data Table -->
              <table class="soil-table">
                <thead>
                  <tr>
                    <th>Mukey</th>
                    <th>Name</th>
                    <th style="text-align: right">Area (ac)</th>
                    <th>Tax Order</th>
                    <th>Drainage</th>
                    <th>pH</th>
                    <th>Organic Matter</th>
                    <th>Texture</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="unit in soilUnitsArray" :key="unit.mukey">
                    <td>{{ unit.mukey }}</td>
                    <td>{{ unit.muname || "-" }}</td>
                    <td style="text-align: right">
                      {{ (unit.area_acres || 0).toFixed(6) }}
                    </td>
                    <td>{{ unit.taxorder || "-" }}</td>
                    <td>{{ unit.drainagecl || "-" }}</td>
                    <td>{{ formatMaybe(unit.ph1to1h2o_r, "") }}</td>
                    <td>{{ formatMaybe(unit.om_r, "%") }}</td>
                    <td>{{ unit.texture || "-" }}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="3"><strong>Total</strong></td>
                    <td style="text-align: right">
                      <strong>{{ totalSoilAcres.toFixed(6) }}</strong>
                    </td>
                    <td colspan="4"></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <!-- No Data States -->
            <div
              v-else-if="
                soilData && soilData.features && soilData.features.length === 0
              "
              class="no-data"
            >
              <p>No soil data found for this area</p>
            </div>
            <div v-else class="no-polygon">
              <p>Draw a polygon to analyze soil data</p>
            </div>
          </div>
        </div>

        <!-- GeoJSON Export Panel -->
        <div class="geojson-output">
          <h3>GeoJSON Export</h3>
          <button @click="toggleGeoJSON" class="btn btn-secondary">
            {{ geoJSONExpanded ? "Collapse" : "Expand" }} GeoJSON
          </button>
          <div v-if="geoJSONExpanded" class="json-container">
            <pre ref="geojsonPre">{{ fullGeoJSON }}</pre>
            <button
              @click="copyGeoJSON"
              class="btn btn-primary"
              :disabled="!fullGeoJSON"
            >
              Copy GeoJSON
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import L from "leaflet";
import "leaflet-draw";
import * as turf from "@turf/turf";
import Split from "split.js";
import "./assets/App.css";

export default {
  name: "GeoAnnotationApp",
  data() {
    return {
      map: null,
      drawnItems: new L.FeatureGroup(),
      geojson: null,
      soilData: null,
      soilLoading: false,
      soilError: null,
      soilProgress: { current: 0, total: 0, message: "" },
      soilElapsedMs: null,
      currentSoilAbort: null,
      maxResultsOption: 0, // 0 means no limit
      // debugOption removed
      soilWorker: null,
      soilJobId: 0,
      baseLayers: {}, // Store different base layers
      overlays: {}, // Store overlay layers (roads, boundaries, labels)
      soilLayers: [], // Store soil polygon layers for map
      soilColors: [], // Store colors for each soil unit
      geoJSONExpanded: false, // For collapsible GeoJSON panel
      lastAnalyzedGeometryHash: null, // Track last analyzed geometry to detect changes
      mapStatus: null, // Status indicator for map loading
    };
  },
  mounted() {
    try {
      this.initializeMap();
      this.$nextTick(() => {
        this.initializeSplit();
      });
    } catch (error) {
      console.error("Error initializing app:", error);
    }
  },
  computed: {
    totalSoilAcres() {
      if (
        !this.soilData ||
        this.soilData.type !== "FeatureCollection" ||
        !this.soilData.features
      )
        return 0;
      return this.soilData.properties?.total_area_acres || 0;
    },
    soilUnitsArray() {
      if (
        !this.soilData ||
        this.soilData.type !== "FeatureCollection" ||
        !this.soilData.features
      )
        return [];

      // Group features by mukey
      const soilUnits = {};
      this.soilData.features.forEach((feature) => {
        const mukey = feature.properties.mukey;
        if (!soilUnits[mukey]) {
          soilUnits[mukey] = {
            mukey,
            muname: feature.properties.muname,
            taxorder: feature.properties.taxorder,
            drainagecl: feature.properties.drainagecl,
            texture: feature.properties.texture,
            ph1to1h2o_r: feature.properties.ph1to1h2o_r,
            om_r: feature.properties.om_r,
            area_acres: 0,
          };
        }
        soilUnits[mukey].area_acres += feature.properties.area_acres || 0;
      });

      // Convert to array and sort by area
      return Object.values(soilUnits).sort(
        (a, b) => b.area_acres - a.area_acres
      );
    },
    progressPercentage() {
      if (this.soilProgress.total === 0) return 0;
      return Math.round(
        (this.soilProgress.current / this.soilProgress.total) * 100
      );
    },
    geoSummary() {
      if (!this.geojson || !this.geojson.summary) return null;
      return this.geojson.summary;
    },
    fullGeoJSON() {
      if (!this.drawnItems.getLayers().length)
        return "Draw a polygon to see GeoJSON";
      const fullGeo = this.drawnItems.toGeoJSON();
      return JSON.stringify(fullGeo, null, 2);
    },
  },
  methods: {
    // Generate a simple hash of the geometry for change detection
    generateGeometryHash(geojsonData) {
      if (!geojsonData || !geojsonData.features) return null;

      // Create a simplified representation for hashing
      const simplified = {
        type: geojsonData.type,
        features: geojsonData.features.map((f) => ({
          type: f.type,
          geometry: f.geometry,
        })),
      };

      // Simple hash using JSON string length and feature count
      const jsonString = JSON.stringify(simplified);
      let hash = 0;
      for (let i = 0; i < jsonString.length; i++) {
        const char = jsonString.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32-bit integer
      }
      return hash.toString();
    },

    initializeMap() {
      // Set initial loading status
      this.mapStatus = {
        type: "info",
        message: "Loading map tiles...",
      };

      // Initialize the map centered on the US center
      this.map = L.map("map").setView([39.8283, -98.5795], 4);

      // Define multiple base layers
      this.baseLayers = {
        OpenStreetMap: L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 25,
            crossOrigin: true,
          }
        ),
        "USGS Satellite": L.tileLayer(
          "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
          {
            attribution:
              'Tiles courtesy of the <a href="https://www.usgs.gov/">U.S. Geological Survey</a>',
            maxZoom: 25,
            crossOrigin: true,
          }
        ),
        "Esri World Imagery": L.tileLayer(
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          {
            attribution:
              "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
            maxZoom: 19,
            crossOrigin: true,
          }
        ),
      };

      // Define overlay layers (transparent for roads, boundaries, labels)
      this.overlays = {
        "OpenStreetMap Roads": L.tileLayer(
          "https://tiles.stadiamaps.com/tiles/stamen_toner_lines/{z}/{x}/{y}{r}.png",
          {
            maxZoom: 25,
            opacity: 0.55,
            crossOrigin: true,
          }
        ),
        Labels: L.tileLayer(
          "https://tiles.stadiamaps.com/tiles/stamen_toner_labels/{z}/{x}/{y}{r}.png",
          {
            maxZoom: 25,
            opacity: 0.94,
            crossOrigin: true,
          }
        ),
      };

      // Add default layer (start with satellite)
      this.baseLayers["USGS Satellite"].addTo(this.map);

      // Add default overlays for immediate visibility (users can toggle off)
      this.overlays["OpenStreetMap Roads"].addTo(this.map);
      this.overlays["Labels"].addTo(this.map);

      // Add layer control with both base layers and overlays
      const layerControl = L.control
        .layers(this.baseLayers, this.overlays, {
          position: "topright",
          collapsed: false,
        })
        .addTo(this.map);

      // Add error handling for tile loading
      this.map.on("tileerror", (e) => {
        console.warn("Tile load failed:", e);
        this.mapStatus = {
          type: "error",
          message:
            "Some map tiles failed to load. Try switching to a different base layer.",
        };
        // Clear status after 5 seconds
        setTimeout(() => {
          this.mapStatus = null;
        }, 5000);

        // Optionally switch to a more reliable layer if current layer fails
        if (e.tile && e.tile.src) {
          // If USGS satellite fails, try Esri
          if (
            e.tile.src.includes("nationalmap.gov") &&
            this.map.hasLayer(this.baseLayers["USGS Satellite"])
          ) {
            console.log("USGS tiles failing, switching to Esri World Imagery");
            this.map.removeLayer(this.baseLayers["USGS Satellite"]);
            this.baseLayers["Esri World Imagery"].addTo(this.map);
            this.mapStatus = {
              type: "info",
              message:
                "Switched to Esri World Imagery due to tile loading issues.",
            };
          }
        }
      });

      // Clear status when tiles load successfully
      this.map.on("tileload", () => {
        if (this.mapStatus && this.mapStatus.type === "error") {
          this.mapStatus = null;
        }
      });

      // Clear loading status when map is ready
      this.map.whenReady(() => {
        setTimeout(() => {
          if (
            this.mapStatus &&
            this.mapStatus.message === "Loading map tiles..."
          ) {
            this.mapStatus = null;
          }
        }, 1000); // Small delay to ensure tiles have started loading
      });

      // Add the drawn items layer to the map
      this.map.addLayer(this.drawnItems);

      // Configure drawing controls
      const drawControl = new L.Control.Draw({
        draw: {
          polygon: {
            allowIntersection: false,
            drawError: {
              color: "#e1e100",
              message: "<strong>Error:</strong> Shape edges cannot cross!",
            },
            shapeOptions: {
              color: "#97009c",
            },
          },
          polyline: false,
          rectangle: {
            shapeOptions: {
              color: "#97009c",
            },
          },
          circle: false,
          marker: false,
          circlemarker: false,
        },
        edit: {
          featureGroup: this.drawnItems,
          remove: true,
        },
      });

      this.map.addControl(drawControl);

      // Event handlers for drawing
      this.map.on(L.Draw.Event.CREATED, this.handleDrawEvent);
      this.map.on(L.Draw.Event.EDITED, this.handleEditEvent);
      this.map.on(L.Draw.Event.DELETED, this.handleDeleteEvent);
    },

    initializeSplit() {
      const splitInstance = Split(["#left-panel", "#right-panel"], {
        sizes: [50, 50],
        minSize: [300, 300],
        gutterSize: 8,
        cursor: "col-resize",
        onDragEnd: () => {
          if (this.map) {
            // Force a full size recalculation after user drags
            this.map.invalidateSize(true);
          }
        },
      });

      // After Split sets initial sizes, Leaflet sometimes needs a tick to render tiles correctly
      // Invalidate size once after a short delay to force tile reflow.
      setTimeout(() => {
        if (this.map) {
          try {
            this.map.invalidateSize(true);
          } catch (e) {
            // ignore
          }
        }
      }, 150);
    },

    zoomToDrawings() {
      if (!this.map || !this.drawnItems) return;
      const bounds = this.drawnItems.getBounds();
      if (bounds.isValid()) {
        this.map.fitBounds(bounds, { padding: [20, 20] });
      }
    },

    async handleDrawEvent(e) {
      const layer = e.layer;
      this.drawnItems.addLayer(layer);
      await this.updateGeoJSON();
    },

    async handleEditEvent(e) {
      await this.updateGeoJSON();
    },

    async handleDeleteEvent(e) {
      await this.updateGeoJSON();
    },

    async updateGeoJSON() {
      try {
        const geojsonData = this.drawnItems.toGeoJSON();
        const features = geojsonData.features || [];

        // Generate hash of current geometry
        const currentGeometryHash = this.generateGeometryHash(geojsonData);

        if (!features.length) {
          // No polygons
          this.geojson = {
            summary: {
              features: 0,
              vertices: 0,
              bbox: null,
              area_acres: 0,
              created: new Date().toISOString(),
            },
          };
          this.soilData = null;
          this.soilLoading = false;
          this.soilError = null;
          this.soilProgress = { current: 0, total: 0, message: "" };
          this.lastAnalyzedGeometryHash = null;
          return;
        }

        // Check if geometry has actually changed
        const geometryChanged =
          currentGeometryHash !== this.lastAnalyzedGeometryHash;

        // Build a lightweight summary to keep in component state (avoid storing full geometry)
        let totalVertices = 0;
        for (const f of features) {
          const geom = f.geometry || {};
          if (geom.type === "Polygon") {
            for (const ring of geom.coordinates || [])
              totalVertices += (ring || []).length;
          } else if (geom.type === "MultiPolygon") {
            for (const poly of geom.coordinates || [])
              for (const ring of poly || [])
                totalVertices += (ring || []).length;
          }
        }
        const bbox = this.drawnItems.getBounds
          ? this.drawnItems.getBounds().toBBoxString()
          : null;
        // Calculate total area in acres
        const totalAreaSqMeters = turf.area(geojsonData);
        const areaAcres = totalAreaSqMeters * 0.000247105; // Convert sq meters to acres
        this.geojson = {
          summary: {
            features: features.length,
            vertices: totalVertices,
            bbox,
            area_acres: areaAcres,
            created: new Date().toISOString(),
          },
        };

        // Fetch soil data only if geometry has changed or we don't have soil data yet
        if (geometryChanged || !this.soilData) {
          console.log(
            `Geometry changed (hash: ${currentGeometryHash}), triggering soil analysis...`
          );
          this.lastAnalyzedGeometryHash = currentGeometryHash;
          await this.refreshSoil();
        } else {
          console.log("Geometry unchanged, skipping soil analysis");
          // Still update the soil layers if we have existing data
          this.$nextTick(() => {
            this.addSoilLayersToMap();
          });
        }
      } catch (error) {
        console.error("Error updating GeoJSON:", error);
      }
    },

    async refreshSoil() {
      if (!this.geojson) return;

      // Clear existing soil layers immediately when starting new analysis
      this.clearSoilLayers();

      // Abort existing request if any
      if (this.currentSoilAbort) {
        try {
          // currentSoilAbort may be an AbortController or an object with abort()
          if (typeof this.currentSoilAbort.abort === "function") {
            this.currentSoilAbort.abort();
          }
        } catch (e) {
          /* ignore */
        }
        this.currentSoilAbort = null;
      }

      this.soilLoading = true;
      this.soilError = null;
      this.soilProgress = { current: 0, total: 0, message: "" };
      this.soilElapsedMs = null;

      const start = performance.now();

      const maxResults =
        this.maxResultsOption && this.maxResultsOption > 0
          ? this.maxResultsOption
          : undefined;

      // Build full geometry on-demand
      const fullGeo = this.drawnItems.toGeoJSON();

      // Clean the GeoJSON to ensure it's compatible with the soil analysis function
      const cleanGeo = this.cleanGeoJSON(fullGeo);

      // Validate GeoJSON before sending to worker
      if (!this.isValidGeoJSON(cleanGeo)) {
        this.soilError = "Invalid geometry drawn. Please draw a valid polygon.";
        this.soilLoading = false;
        return;
      }

      console.log(
        "Sending GeoJSON to worker:",
        JSON.stringify(cleanGeo, null, 2)
      );

      // Always use Web Worker for soil processing (no backend dependency)
      if (typeof Worker !== "undefined") {
        // ensure worker exists
        if (!this.soilWorker) {
          try {
            this.soilWorker = new Worker(
              new URL("./soil.worker.js", import.meta.url),
              {
                type: "module",
              }
            );
          } catch (err) {
            console.warn("Failed to create worker:", err);
            this.soilError = "Soil analysis not available (worker failed)";
            this.soilLoading = false;
            return;
          }
        }

        if (this.soilWorker) {
          const jobId = ++this.soilJobId;

          const onMessage = (ev) => {
            const msg = ev.data || {};
            if (msg.id !== jobId) return; // ignore other jobs
            if (msg.type === "progress") {
              this.soilProgress = msg.progress || this.soilProgress;
            } else if (msg.type === "result") {
              this.soilElapsedMs = performance.now() - start;
              this.soilData = msg.results || [];

              // Add soil layers to map for visualization
              this.addSoilLayersToMap();

              // Force Vue to update the UI
              this.$nextTick(() => {
                console.log(
                  "Soil analysis complete:",
                  this.soilData.features?.length || 0,
                  "features",
                  this.soilUnitsArray.length,
                  "units"
                );
              });

              this.soilLoading = false;
              this.currentSoilAbort = null;
              this.soilWorker.removeEventListener("message", onMessage);
              resolvePromise();
            } else if (msg.type === "error") {
              this.soilElapsedMs = performance.now() - start;
              if (msg.aborted) {
                this.soilError = "Request canceled";
              } else {
                this.soilError = msg.error || "Unknown error";
              }
              this.soilData = null;
              this.soilLoading = false;
              this.currentSoilAbort = null;
              this.soilWorker.removeEventListener("message", onMessage);
              rejectPromise(new Error(this.soilError));
            }
          };

          // We'll return a promise that resolves when the worker reports result/error
          let resolvePromise, rejectPromise;
          const prom = new Promise((resolve, reject) => {
            resolvePromise = resolve;
            rejectPromise = reject;
          });

          this.soilWorker.addEventListener("message", onMessage);

          // Provide a simple abort handle that posts an abort message to the worker
          this.currentSoilAbort = {
            abort: () => {
              try {
                this.soilWorker.postMessage({ type: "abort" });
              } catch (e) {
                /* ignore */
              }
            },
          };

          // Start the job
          try {
            this.soilWorker.postMessage({
              type: "start",
              id: jobId,
              geojson: cleanGeo,
              options: { maxResults, debug: true }, // Enable debug mode
            });
          } catch (err) {
            // If posting fails, show error
            this.soilWorker.removeEventListener("message", onMessage);
            this.currentSoilAbort = null;
            this.soilLoading = false;
            this.soilError = "Failed to start soil analysis: " + err.message;
            console.error("Failed to post to worker:", err);
            return;
          }

          // Wait for worker completion
          return prom;
        }
      } else {
        // Worker not available
        this.soilError =
          "Soil analysis not available (Web Workers not supported)";
        this.soilLoading = false;
        return;
      }
    },

    cancelSoilRequest() {
      // Abort either the controller or the worker
      if (this.currentSoilAbort) {
        try {
          if (typeof this.currentSoilAbort.abort === "function") {
            this.currentSoilAbort.abort();
          }
        } catch (e) {
          /* ignore */
        }
      }
      // Also notify the worker explicitly if present
      if (this.soilWorker) {
        try {
          this.soilWorker.postMessage({ type: "abort" });
        } catch (e) {
          /* ignore */
        }
      }
    },

    formatMaybe(value, unit) {
      if (value == null) return "-";
      return `${value}${unit ? " " + unit : ""}`;
    },

    getSoilColor(index) {
      // Generate consistent colors for soil units
      if (!this.soilColors[index]) {
        const colors = [
          "#FF6B6B",
          "#4ECDC4",
          "#45B7D1",
          "#96CEB4",
          "#FFEAA7",
          "#DDA0DD",
          "#98D8C8",
          "#F7DC6F",
          "#BB8FCE",
          "#85C1E9",
          "#F8C471",
          "#82E0AA",
          "#F1948A",
          "#85C0C0",
          "#D7BDE2",
        ];
        this.soilColors[index] = colors[index % colors.length];
      }
      return this.soilColors[index];
    },

    addSoilLayersToMap() {
      // Clear existing soil layers
      this.clearSoilLayers();

      if (
        !this.soilData ||
        this.soilData.type !== "FeatureCollection" ||
        !this.soilData.features
      ) {
        return;
      }

      // Group features by mukey for coloring and display
      const soilUnits = {};
      this.soilData.features.forEach((feature) => {
        const mukey = feature.properties.mukey;
        if (!soilUnits[mukey]) {
          soilUnits[mukey] = {
            mukey,
            muname: feature.properties.muname,
            taxorder: feature.properties.taxorder,
            drainagecl: feature.properties.drainagecl,
            texture: feature.properties.texture,
            ph1to1h2o_r: feature.properties.ph1to1h2o_r,
            om_r: feature.properties.om_r,
            area_acres: 0,
            features: [],
          };
        }
        soilUnits[mukey].area_acres += feature.properties.area_acres || 0;
        soilUnits[mukey].features.push(feature);
      });

      // Convert to array and sort by area
      const soilUnitsArray = Object.values(soilUnits).sort(
        (a, b) => b.area_acres - a.area_acres
      );

      // Add each soil unit's features to the map
      soilUnitsArray.forEach((soilUnit, index) => {
        if (soilUnit.features && soilUnit.features.length > 0) {
          const color = this.getSoilColor(index);

          // Create GeoJSON for this soil unit's intersection areas
          const soilGeoJson = {
            type: "FeatureCollection",
            features: soilUnit.features,
          };

          // Add to map with styling
          const layer = L.geoJSON(soilGeoJson, {
            style: {
              fillColor: color,
              color: color,
              weight: 2,
              fillOpacity: 0.6,
              opacity: 0.8,
            },
            onEachFeature: (feature, layer) => {
              const props = feature.properties;
              layer.bindPopup(`
                <div>
                  <strong>${
                    soilUnit.muname || `Soil Unit ${props.mukey}`
                  }</strong><br>
                  <strong>Intersection Area:</strong> ${props.area_acres.toFixed(
                    3
                  )} acres<br>
                  <strong>Taxonomic Order:</strong> ${
                    soilUnit.taxorder || "N/A"
                  }<br>
                  <strong>Drainage:</strong> ${soilUnit.drainagecl || "N/A"}<br>
                  <strong>Texture:</strong> ${soilUnit.texture || "N/A"}<br>
                  <strong>pH:</strong> ${soilUnit.ph1to1h2o_r || "N/A"}<br>
                  <strong>Organic Matter:</strong> ${
                    soilUnit.om_r && typeof soilUnit.om_r === "number"
                      ? soilUnit.om_r.toFixed(1) + "%"
                      : "N/A"
                  }
                </div>
              `);
            },
          });

          layer.addTo(this.map);
          this.soilLayers.push(layer);
        }
      });

      // Ensure soil layers are on top of drawn polygons
      this.$nextTick(() => {
        this.soilLayers.forEach((layer) => {
          if (layer.bringToFront) {
            layer.bringToFront();
          }
        });
        // Force map to refresh
        if (this.map && this.map.invalidateSize) {
          this.map.invalidateSize();
        }
      });
    },

    clearSoilLayers() {
      // Remove all soil layers from map
      this.soilLayers.forEach((layer) => {
        if (this.map.hasLayer(layer)) {
          this.map.removeLayer(layer);
        }
      });
      this.soilLayers = [];
      this.soilColors = [];
    },

    forceRecalculate() {
      // Force recalculation by resetting the geometry hash
      console.log("Forcing recalculation...");
      this.lastAnalyzedGeometryHash = null;
      this.updateGeoJSON();
    },

    switchToLayer(layerName) {
      if (!this.baseLayers[layerName] || !this.map) return;

      try {
        // Remove all current base layers
        Object.values(this.baseLayers).forEach((layer) => {
          if (this.map.hasLayer(layer)) {
            this.map.removeLayer(layer);
          }
        });

        // Add the selected layer
        this.baseLayers[layerName].addTo(this.map);
      } catch (error) {
        console.error("Error switching layer:", error);
      }
    },

    toggleOverlay(overlayName) {
      if (!this.overlays[overlayName] || !this.map) return;

      try {
        const overlay = this.overlays[overlayName];
        if (this.map.hasLayer(overlay)) {
          // Remove overlay if it's currently active
          this.map.removeLayer(overlay);
        } else {
          // Add overlay if it's not active
          overlay.addTo(this.map);
        }
      } catch (error) {
        console.error("Error toggling overlay:", error);
      }
    },

    downloadGeoJSON() {
      // Build full GeoJSON on demand from drawnItems to avoid storing large geometry in component state
      const fullGeo = this.drawnItems.toGeoJSON();
      if (!fullGeo || !fullGeo.features || !fullGeo.features.length) return;
      const dataStr = JSON.stringify(fullGeo, null, 2);
      const dataBlob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(dataBlob);

      const link = document.createElement("a");
      link.href = url;
      link.download = `geojson-${new Date().getTime()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },

    clearAll() {
      this.drawnItems.clearLayers();
      this.clearSoilLayers(); // Clear soil visualization layers
      this.geojson = null;
      this.soilData = null;
      this.soilLoading = false;
      this.soilError = null;
      this.soilProgress = { current: 0, total: 0, message: "" };
      this.soilElapsedMs = null;
      this.lastAnalyzedGeometryHash = null; // Reset geometry hash
      if (this.currentSoilAbort) {
        try {
          this.currentSoilAbort.abort();
        } catch (e) {
          /* ignore */
        }
        this.currentSoilAbort = null;
      }
    },

    isValidGeometry(geometry) {
      try {
        if (!geometry || !geometry.coordinates) return false;

        if (geometry.type === "Polygon") {
          // Check if coordinates is array of rings, each ring has at least 4 points
          if (
            !Array.isArray(geometry.coordinates) ||
            geometry.coordinates.length === 0
          )
            return false;
          for (const ring of geometry.coordinates) {
            if (!Array.isArray(ring) || ring.length < 4) return false; // Need at least 4 points for closed polygon
            for (const point of ring) {
              if (
                !Array.isArray(point) ||
                point.length < 2 ||
                typeof point[0] !== "number" ||
                typeof point[1] !== "number"
              )
                return false;
            }
          }
          return true;
        } else if (geometry.type === "MultiPolygon") {
          // Check if coordinates is array of polygons
          if (
            !Array.isArray(geometry.coordinates) ||
            geometry.coordinates.length === 0
          )
            return false;
          for (const polygon of geometry.coordinates) {
            if (!Array.isArray(polygon) || polygon.length === 0) return false;
            for (const ring of polygon) {
              if (!Array.isArray(ring) || ring.length < 4) return false;
              for (const point of ring) {
                if (
                  !Array.isArray(point) ||
                  point.length < 2 ||
                  typeof point[0] !== "number" ||
                  typeof point[1] !== "number"
                )
                  return false;
              }
            }
          }
          return true;
        }
        return false;
      } catch (error) {
        console.error("Error validating geometry:", error);
        return false;
      }
    },

    isValidGeoJSON(geojson) {
      try {
        if (!geojson || typeof geojson !== "object") {
          console.error("GeoJSON is not an object");
          return false;
        }

        if (geojson.type !== "FeatureCollection") {
          console.error("GeoJSON type is not FeatureCollection:", geojson.type);
          return false;
        }

        if (!Array.isArray(geojson.features) || geojson.features.length === 0) {
          console.error("GeoJSON has no features");
          return false;
        }

        for (const feature of geojson.features) {
          if (feature.type !== "Feature") {
            console.error("Feature type is not Feature:", feature.type);
            return false;
          }

          if (!feature.geometry) {
            console.error("Feature has no geometry");
            return false;
          }

          if (!this.isValidGeometry(feature.geometry)) {
            console.error("Feature has invalid geometry");
            return false;
          }

          // Additional validation for coordinate ranges (should be valid lat/lng)
          if (!this.hasValidCoordinates(feature.geometry)) {
            console.error("Feature has invalid coordinates");
            return false;
          }
        }

        return true;
      } catch (error) {
        console.error("Error validating GeoJSON:", error);
        return false;
      }
    },

    hasValidCoordinates(geometry) {
      try {
        if (!geometry || !geometry.coordinates) return false;

        const checkCoords = (coords) => {
          if (Array.isArray(coords)) {
            for (const item of coords) {
              if (Array.isArray(item)) {
                // Check if it's a point [lng, lat]
                if (
                  item.length === 2 &&
                  typeof item[0] === "number" &&
                  typeof item[1] === "number"
                ) {
                  const [lng, lat] = item;
                  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
                    console.error(`Invalid coordinate: [${lng}, ${lat}]`);
                    return false;
                  }
                } else {
                  // Recurse for nested arrays
                  if (!checkCoords(item)) return false;
                }
              }
            }
          }
          return true;
        };

        return checkCoords(geometry.coordinates);
      } catch (error) {
        console.error("Error checking coordinates:", error);
        return false;
      }
    },

    cleanGeoJSON(geojson) {
      try {
        // Create a deep copy and clean it
        const cleaned = JSON.parse(JSON.stringify(geojson));

        // Ensure features have minimal properties
        if (cleaned.features) {
          cleaned.features.forEach((feature) => {
            // Keep only essential properties
            feature.properties = feature.properties || {};
            // Remove any Leaflet-specific properties if they exist
            delete feature.properties._leaflet_id;
            delete feature.properties._leaflet_layer_id;
          });
        }

        return cleaned;
      } catch (error) {
        console.error("Error cleaning GeoJSON:", error);
        return geojson; // Return original if cleaning fails
      }
    },

    toggleGeoJSON() {
      this.geoJSONExpanded = !this.geoJSONExpanded;
    },

    copyGeoJSON() {
      if (
        !this.fullGeoJSON ||
        this.fullGeoJSON === "Draw a polygon to see GeoJSON"
      )
        return;
      navigator.clipboard
        .writeText(this.fullGeoJSON)
        .then(() => {
          alert("GeoJSON copied to clipboard!");
        })
        .catch((err) => {
          console.error("Failed to copy: ", err);
          // Fallback: select the text
          const pre = this.$refs.geojsonPre;
          if (pre) {
            const range = document.createRange();
            range.selectNodeContents(pre);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            alert("GeoJSON selected. Press Ctrl+C to copy.");
          }
        });
    },
  },
};
</script>
