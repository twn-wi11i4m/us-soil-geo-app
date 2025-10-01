import * as turf from "@turf/turf";
import wkx from "wellknown";
import polygonClipping from "polygon-clipping";

// Configuration
const SDA_CONFIG = {
  API_URL:
    "https://sdmdataaccess.nrcs.usda.gov/Tabular/SDMTabularService/post.rest",
  REQUEST_TIMEOUT: 120000, // 120s timeout
  MAX_RETRIES: 3,
  ACRES_PER_SQM: 0.000247105381, // Conversion factor
};

// Helper functions
/**
 * Convert square meters to acres.
 * @param {*} areaSqm, area in square meters
 * @returns {number} area in acres
 */
const sqmToAcres = (areaSqm) =>
  Math.round(areaSqm * SDA_CONFIG.ACRES_PER_SQM * 1e6) / 1e6;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Robust intersection calculation using multiple methods
/**
 * Calculate the robust intersection of soil and study geometries.
 * @param {*} soilGeometry, GeoJSON geometry
 * @param {*} studyGeometry, GeoJSON geometry
 * @returns {Object|null} { geometry, area, method } or null if no intersection
 */
function calculateRobustIntersection(soilGeometry, studyGeometry) {
  // Method 1: Try turf.intersect first (fastest when it works)
  try {
    const soilFeature = {
      type: "Feature",
      properties: {},
      geometry: soilGeometry,
    };

    const studyFeature = {
      type: "Feature",
      properties: {},
      geometry: studyGeometry,
    };

    const intersection = turf.intersect(soilFeature, studyFeature);

    if (intersection && intersection.geometry) {
      const area = turf.area(intersection);
      if (area >= 0.1) {
        // At least 0.1 sq meters
        return {
          geometry: intersection.geometry,
          area: area,
          method: "turf_intersect",
        };
      }
    }
  } catch (turfError) {
    // Continue to polygon-clipping method
  }

  // Method 2: Use polygon-clipping library (more robust)
  try {
    // Convert geometries to coordinate arrays for polygon-clipping
    const soilCoords = getPolygonCoordinates(soilGeometry);
    const studyCoords = getPolygonCoordinates(studyGeometry);

    if (!soilCoords || !studyCoords) {
      return null;
    }

    // Use polygon-clipping library for robust intersection calculation
    const intersectionResult = polygonClipping.intersection(
      [soilCoords],
      [studyCoords]
    );

    if (intersectionResult.length === 0) {
      return null;
    }

    // Convert result back to GeoJSON
    const intersectionGeometry = {
      type: intersectionResult.length === 1 ? "Polygon" : "MultiPolygon",
      coordinates:
        intersectionResult.length === 1
          ? intersectionResult[0]
          : intersectionResult,
    };

    // Create turf feature to calculate area
    const intersectionFeature = turf.feature(intersectionGeometry);
    const area = turf.area(intersectionFeature);

    if (area >= 0.1) {
      // At least 0.1 sq meters
      return {
        geometry: intersectionGeometry,
        area: area,
        method: "polygon_clipping",
      };
    }
  } catch (error) {
    // Continue to containment check
  }

  // Method 3: Check containment relationships
  try {
    const soilFeature = turf.feature(soilGeometry);
    const studyFeature = turf.feature(studyGeometry);

    if (turf.booleanWithin(soilFeature, studyFeature)) {
      // Soil polygon is completely within study area
      const area = turf.area(soilFeature);
      return {
        geometry: soilGeometry,
        area: area,
        method: "soil_within_study",
      };
    } else if (turf.booleanWithin(studyFeature, soilFeature)) {
      // Study area is completely within soil polygon
      const area = turf.area(studyFeature);
      return {
        geometry: studyGeometry,
        area: area,
        method: "study_within_soil",
      };
    }
  } catch (containmentError) {
    // No containment found
  }

  return null;
}

// Extract coordinates from polygon geometry for polygon-clipping
/**
 * Get the coordinates array from a Polygon or MultiPolygon geometry.
 * @param {*} geometry, GeoJSON geometry
 * @returns {Array|null} coordinates array or null if invalid
 */
function getPolygonCoordinates(geometry) {
  if (!geometry || !geometry.coordinates) {
    return null;
  }

  switch (geometry.type) {
    case "Polygon":
      return geometry.coordinates;
    case "MultiPolygon":
      // For MultiPolygon, return the first polygon for simplicity
      return geometry.coordinates[0];
    default:
      return null;
  }
}

// Execute SDA query with retries
/**
 * Execute a spatial data API query with retries.
 * @param {*} query, the query to execute
 * @param {*} options, additional options for the query
 * @returns {Promise<Array>} the query results
 */
async function executeSDQuery(query, options = {}) {
  const {
    format = "JSON",
    retries = SDA_CONFIG.MAX_RETRIES,
    timeout = SDA_CONFIG.REQUEST_TIMEOUT,
    signal,
  } = options;

  const requestBody = { query: query.trim(), format };
  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = signal ? null : new AbortController();
      const timeoutId = !signal
        ? setTimeout(() => controller?.abort(), timeout)
        : null;

      const response = await fetch(SDA_CONFIG.API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: signal || controller?.signal,
      });

      if (timeoutId) clearTimeout(timeoutId);

      if (!response.ok) {
        let errorText;
        try {
          errorText = await response.text();
        } catch (e) {
          errorText = `HTTP ${response.status} ${response.statusText}`;
        }
        throw new Error(`SDA API Error ${response.status}: ${errorText}`);
      }

      // Check content type
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const textResponse = await response.text();
        throw new Error(
          `SDA API returned non-JSON response: ${textResponse.substring(
            0,
            200
          )}`
        );
      }

      const data = await response.json();
      const results = data.Table || [];

      return results;
    } catch (error) {
      lastError = error;

      if (error.name === "AbortError") {
        throw new Error(
          "Query timeout - try reducing scope or increasing timeout"
        );
      }

      // Exponential backoff for retries
      if (attempt < retries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await wait(delay);
      }
    }
  }

  throw lastError;
}

// Extract GeoJSON geometries and convert to WKT
/**
 * Extract and convert GeoJSON geometry to WKT format.
 * @param {*} geojson, GeoJSON geometry
 * @param {*} debug, flag to enable debug logging
 * @returns {Object|null} { geometry, wktString } or null if invalid
 */
function extractAndConvertGeometry(geojson, debug = false) {
  if (!geojson) {
    if (debug) console.log("No geojson provided");
    return null;
  }

  if (debug) {
    console.log(
      "Processing geojson:",
      JSON.stringify(geojson).substring(0, 200) + "..."
    );
  }

  let geometry;
  try {
    if (geojson.type === "FeatureCollection" && geojson.features?.length > 0) {
      // Use the first feature's geometry or union multiple features
      if (geojson.features.length === 1) {
        geometry = geojson.features[0].geometry;
        if (debug) console.log("Using single feature geometry");
      } else {
        if (debug) console.log(`Unioning ${geojson.features.length} features`);
        // Union multiple features
        let union = turf.feature(geojson.features[0].geometry);
        for (let i = 1; i < geojson.features.length; i++) {
          try {
            const unionResult = turf.union(
              union,
              turf.feature(geojson.features[i].geometry)
            );
            if (unionResult) {
              union = unionResult;
            } else {
              if (debug) console.warn(`Union failed for feature ${i}`);
            }
          } catch (unionError) {
            if (debug)
              console.warn(`Error unioning feature ${i}:`, unionError.message);
          }
        }
        geometry = union.geometry;
      }
    } else if (geojson.type === "Feature") {
      geometry = geojson.geometry;
    } else if (geojson.type === "Polygon" || geojson.type === "MultiPolygon") {
      geometry = geojson;
    } else {
      throw new Error(`Unsupported GeoJSON type: ${geojson.type}`);
    }

    if (!geometry) {
      throw new Error("No valid geometry found after processing");
    }

    // Validate geometry
    if (!geometry.type || !geometry.coordinates) {
      throw new Error("Invalid geometry: missing type or coordinates");
    }

    // Convert to WKT
    const wktString = wkx.stringify(geometry);

    if (!wktString || wktString.length === 0) {
      throw new Error("WKT conversion resulted in empty string");
    }

    if (debug) {
      console.log(`Converted geometry to WKT: ${wktString.length} characters`);
      console.log(`WKT preview: ${wktString.substring(0, 100)}...`);
    }

    return { geometry, wktString };
  } catch (error) {
    console.error("Error in extractAndConvertGeometry:", error);
    throw new Error(`Geometry processing failed: ${error.message}`);
  }
}

// Get soil map unit keys (MUKEYs)
/**
 * Get soil map unit keys (MUKEYs) from a WKT string.
 * @param {*} wktString, WKT representation of the study area
 * @param {*} options, additional options for the query
 * @returns {Promise<Array>} list of MUKEYs
 */
async function getSoilMapUnitKeys(wktString, options = {}) {
  const { debug = false, signal } = options;

  const mukeyQuery = `SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${wktString}')`;

  const mukeyData = await executeSDQuery(mukeyQuery, { debug, signal });
  const mukeys = mukeyData
    .map((row) => String(row[0]))
    .filter((key) => key && key.trim());

  if (debug) {
    console.log(
      `Found ${mukeys.length} soil map units intersecting study area:`,
      mukeys
    );
  }

  return mukeys;
}

// Get comprehensive soil properties
/**
 * Get soil properties for a list of map unit keys (MUKEYs).
 * @param {*} mukeys, list of MUKEYs
 * @param {*} options, additional options for the query
 * @returns {Promise<Object>} soil properties for each MUKEY
 */
async function getSoilProperties(mukeys, options = {}) {
  const { debug = false, signal } = options;

  if (!mukeys || mukeys.length === 0) return {};

  const soilPropertiesQuery = `
    WITH RankedSoils AS (
        SELECT 
            m.mukey,                    -- Map unit key (unique identifier)
            m.muname,                   -- Map unit name (descriptive name)
            c.taxorder,                 -- Soil taxonomic order (highest classification level)
            c.taxsuborder,              -- Soil taxonomic suborder 
            c.drainagecl,               -- Drainage class (e.g., well drained, poorly drained)
            c.taxreaction,              -- Soil reaction (pH category)
            c.taxclname,                -- Taxonomic class name
            h.ph1to1h2o_r,              -- pH in water (1:1 ratio) - representative value
            h.om_r,                     -- Organic matter content (%) - representative value
            h.sandtotal_r,              -- Total sand percentage - representative value
            h.silttotal_r,              -- Total silt percentage - representative value
            h.claytotal_r,              -- Total clay percentage - representative value
            tg.texture,                 -- Soil texture class (e.g., loam, clay loam)
            ROW_NUMBER() OVER (
                PARTITION BY m.mukey 
                ORDER BY c.comppct_r DESC, h.hzdept_r ASC
            ) AS soil_rank
        FROM mapunit m                  -- Map units table
        INNER JOIN component c ON m.mukey = c.mukey           -- Soil components in each map unit
        INNER JOIN chorizon h ON h.cokey = c.cokey            -- Soil horizons for each component
        INNER JOIN chtexturegrp tg ON tg.chkey = h.chkey      -- Texture information for each horizon
        WHERE m.mukey IN (${mukeys
          .map((k) => `'${k}'`)
          .join(",")})    -- Filter to our study area map units
            AND c.majcompflag = 'Yes'                         -- Only major components (primary soils)
    )
    SELECT 
        mukey, muname, taxorder, taxsuborder, drainagecl, taxreaction, taxclname,
        ph1to1h2o_r, om_r, sandtotal_r, silttotal_r, claytotal_r, texture
    FROM RankedSoils
    WHERE soil_rank = 1  -- Get only the most representative soil for each map unit
  `;

  const soilData = await executeSDQuery(soilPropertiesQuery, { debug, signal });

  const soilProperties = {};
  soilData.forEach((row) => {
    const [
      mukey,
      muname,
      taxorder,
      taxsuborder,
      drainagecl,
      taxreaction,
      taxclname,
      ph1to1h2o_r,
      om_r,
      sandtotal_r,
      silttotal_r,
      claytotal_r,
      texture,
    ] = row;

    soilProperties[mukey] = {
      mukey,
      muname,
      taxorder,
      taxsuborder,
      drainagecl,
      taxreaction,
      taxclname,
      ph1to1h2o_r,
      om_r,
      sandtotal_r,
      silttotal_r,
      claytotal_r,
      texture,
    };
  });

  if (debug) {
    console.log(
      `Retrieved soil properties for ${
        Object.keys(soilProperties).length
      } map units`
    );
  }

  return soilProperties;
}

// Calculate soil intersections
/**
 * Calculate soil intersections with the study area.
 * @param {*} mukeys, list of MUKEYs
 * @param {*} studyAreaWkt, WKT representation of the study area
 * @param {*} studyAreaGeometry, GeoJSON geometry of the study area
 * @param {*} soilProperties, soil properties for each MUKEY
 * @param {*} options, additional options for the query
 * @returns {Promise<Array>} list of intersection results
 */
async function calculateSoilIntersections(
  mukeys,
  studyAreaWkt,
  studyAreaGeometry,
  soilProperties,
  options = {}
) {
  const { debug = false, signal, progressCallback } = options;

  const results = [];
  let processed = 0;

  for (const mukey of mukeys) {
    try {
      if (progressCallback) {
        progressCallback({
          current: processed,
          total: mukeys.length,
          message: `Processing soil unit ${mukey}...`,
          percentage: Math.round((processed / mukeys.length) * 100),
        });
      }

      const polygonQuery = `SELECT * FROM SDA_Get_MupolygonWktWgs84_from_Mukey(${mukey})`;
      const polygonData = await executeSDQuery(polygonQuery, { debug, signal });

      if (polygonData.length === 0) {
        if (debug) console.log(`No polygon data for MUKEY ${mukey}`);
        processed++;
        continue;
      }

      let totalIntersectionArea = 0;
      const intersectionFeatures = [];

      for (const [wktPolygon] of polygonData) {
        try {
          const soilGeometry = wkx.parse(wktPolygon);

          if (debug) {
            console.log(
              `  Processing soil polygon for MUKEY ${mukey}: ${wktPolygon.length} characters`
            );
          }

          const soilFeature = {
            type: "Feature",
            properties: { mukey },
            geometry: soilGeometry,
          };

          const studyFeature = {
            type: "Feature",
            properties: {},
            geometry: studyAreaGeometry,
          };

          let intersection = null;
          let intersectionMethod = "";

          try {
            const intersects = turf.booleanIntersects(
              soilFeature,
              studyFeature
            );

            if (intersects) {
              if (debug) {
                console.log(
                  `    ✓ Geometries intersect, calculating precise intersection...`
                );
              }

              const intersectionResult = calculateRobustIntersection(
                soilGeometry,
                studyAreaGeometry
              );

              if (intersectionResult) {
                intersection = {
                  type: "Feature",
                  properties: {},
                  geometry: intersectionResult.geometry,
                };
                intersectionMethod = intersectionResult.method;
                if (debug) {
                  console.log(
                    `      ✓ Intersection calculated: ${intersectionResult.area.toFixed(
                      1
                    )} sq meters (${intersectionMethod})`
                  );
                }
              } else {
                if (debug) {
                  console.log(
                    `      ✗ No valid intersection found with any method`
                  );
                }
              }
            } else {
              if (debug) {
                console.log(`      ✗ No spatial intersection detected`);
              }
            }
          } catch (geometricError) {
            if (debug) {
              console.log(
                `      ✗ Geometric calculation failed: ${geometricError.message}`
              );
            }
          }

          if (intersection && intersection.geometry) {
            const areaSquareMeters = turf.area(intersection);
            const areaAcres = sqmToAcres(areaSquareMeters);

            if (areaAcres > 0.0001) {
              totalIntersectionArea += areaAcres;

              intersectionFeatures.push({
                type: "Feature",
                properties: {
                  mukey,
                  area_acres: areaAcres,
                  area_square_meters: areaSquareMeters,
                  intersection_method: intersectionMethod,
                  ...soilProperties[mukey],
                },
                geometry: intersection.geometry,
              });

              if (debug) {
                console.log(
                  `    ✓ Intersection: ${areaAcres.toFixed(
                    6
                  )} acres (${intersectionMethod})`
                );
              }
            }
          }
        } catch (polygonError) {
          if (debug)
            console.warn(
              `Error processing polygon for MUKEY ${mukey}:`,
              polygonError.message
            );
        }
      }

      if (totalIntersectionArea > 0 && soilProperties[mukey]) {
        results.push({
          mukey,
          area_acres: totalIntersectionArea,
          intersectionFeatures,
        });

        if (debug) {
          console.log(
            `✓ Added soil unit ${mukey}: ${totalIntersectionArea.toFixed(
              3
            )} acres total, ${intersectionFeatures.length} features`
          );
        }
      }

      processed++;
    } catch (error) {
      if (debug)
        console.error(`Error processing MUKEY ${mukey}:`, error.message);
      processed++;
    }
  }

  if (progressCallback) {
    progressCallback({
      current: processed,
      total: mukeys.length,
      message: "Spatial analysis complete",
      percentage: 100,
    });
  }

  results.sort((a, b) => (b.area_acres || 0) - (a.area_acres || 0));

  if (debug) {
    const totalArea = results.reduce(
      (sum, unit) => sum + (unit.area_acres || 0),
      0
    );
    console.log(
      `Spatial analysis complete: ${
        results.length
      } soil units, ${totalArea.toFixed(3)} total acres`
    );
  }

  return results;
}

// Main function - returns GeoJSON FeatureCollection
/**
 * Get soil polygons and their areas for a given GeoJSON feature.
 * @param {*} geojson, input GeoJSON feature collection
 * @param {*} maxResults, maximum number of results to return. Default is 100.
 * @param {*} debug, enable debug mode
 * @param {*} normalizeToBoundary, whether to normalize to the study area boundary
 * @param {*} signal, abort signal for request
 * @param {*} progressCallback, callback for progress updates
 * @returns {Promise<GeoJSON.FeatureCollection>} GeoJSON FeatureCollection of soil polygons and their areas.
 *
 * Example usage:
 * const soilData = await getSoilPolygonsAndAreas(geojson);
 *
 * Example output:
 * { type: "FeatureCollection",
 *   features: [
 *     { type: "Feature",
 *       properties: {
 *         mukey: "123456",
 *         area_acres: 10.5,
 *         area_square_meters: 42500,
 *         intersection_method: "union",
 *         ...otherProperties
 *       },
 *       geometry: {
 *         type: "Polygon",
 *         coordinates: [ ... ]
 *       }
 *     },
 *     ...
 *   ],
 *   properties: {
 *     total_area_acres: 150.75,
 *     mapunit_count: 15,
 *     study_area: { ...original input geojson... }
 *   }
 * }
 *
 * Notes:
 * - The function handles complex geometries and large areas by limiting the number of soil units processed.
 * - Soil data is fetched asynchronously with loading states.
 * - The application handles various edge cases in soil data geometry.
 * - Area calculations account for overlapping soil units to provide accurate totals.
 */
export async function getSoilPolygonsAndAreas(
  geojson,
  maxResults = 100,
  debug = false,
  normalizeToBoundary = false,
  signal = null,
  progressCallback = null
) {
  try {
    // Validate input GeoJSON
    if (!geojson) {
      throw new Error("No GeoJSON provided");
    }

    if (typeof geojson !== "object") {
      throw new Error("GeoJSON must be an object");
    }

    if (!geojson.type) {
      throw new Error("GeoJSON must have a 'type' property");
    }

    if (debug) {
      console.log("Starting soil analysis with GeoJSON type:", geojson.type);
    }

    if (progressCallback) {
      progressCallback({
        current: 0,
        total: 100,
        message: "Converting geometry...",
        percentage: 0,
      });
    }

    const { geometry: studyAreaGeometry, wktString: studyAreaWkt } =
      extractAndConvertGeometry(geojson, debug);

    if (!studyAreaGeometry || !studyAreaWkt) {
      throw new Error("Failed to extract valid geometry from GeoJSON");
    }

    if (progressCallback) {
      progressCallback({
        current: 20,
        total: 100,
        message: "Finding soil map units...",
        percentage: 20,
      });
    }

    const mukeys = await getSoilMapUnitKeys(studyAreaWkt, { debug, signal });

    if (mukeys.length === 0) {
      if (debug) console.log("No soil map units found for the study area");
      return {
        type: "FeatureCollection",
        features: [],
      };
    }

    const limitedMukeys = maxResults > 0 ? mukeys.slice(0, maxResults) : mukeys;
    if (mukeys.length > maxResults && maxResults > 0) {
      if (debug)
        console.log(
          `Limiting to ${maxResults} soil units out of ${mukeys.length} found`
        );
    }

    if (progressCallback) {
      progressCallback({
        current: 40,
        total: 100,
        message: "Retrieving soil properties...",
        percentage: 40,
      });
    }

    const soilProperties = await getSoilProperties(limitedMukeys, {
      debug,
      signal,
    });

    if (progressCallback) {
      progressCallback({
        current: 60,
        total: 100,
        message: "Calculating spatial intersections...",
        percentage: 60,
      });
    }

    const results = await calculateSoilIntersections(
      limitedMukeys,
      studyAreaWkt,
      studyAreaGeometry,
      soilProperties,
      {
        debug,
        signal,
        progressCallback: (subProgress) => {
          if (progressCallback) {
            progressCallback({
              current: Math.round(
                60 + (subProgress.current / subProgress.total) * 35
              ),
              total: 100,
              message: subProgress.message,
              percentage: Math.round(
                60 + (subProgress.current / subProgress.total) * 35
              ),
            });
          }
        },
      }
    );

    if (progressCallback) {
      progressCallback({
        current: 100,
        total: 100,
        message: "Analysis complete",
        percentage: 100,
      });
    }

    // Collect all intersection features into a single GeoJSON FeatureCollection
    const allFeatures = [];
    results.forEach((unit) => {
      if (unit.intersectionFeatures) {
        allFeatures.push(...unit.intersectionFeatures);
      }
    });

    const geoJsonResult = {
      type: "FeatureCollection",
      features: allFeatures,
      properties: {
        total_area_acres: results.reduce(
          (sum, unit) => sum + (unit.area_acres || 0),
          0
        ),
        mapunit_count: results.length,
        study_area: geojson,
      },
    };

    if (debug) {
      const totalArea = geoJsonResult.properties.total_area_acres;
      console.log(
        `Final results: ${results.length} soil units, ${totalArea.toFixed(
          3
        )} total acres`
      );
    }

    return geoJsonResult;
  } catch (error) {
    console.error("Error in soil analysis:", error);
    throw new Error(`Soil analysis failed: ${error.message}`);
  }
}
