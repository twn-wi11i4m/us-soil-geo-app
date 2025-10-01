#!/usr/bin/env node

// US Soil Information Analysis - JavaScript Version
// Based on the Python notebook example_1.ipynb
// This script demonstrates how to analyze soil data for a specific geographic region

import fetch from "node-fetch";
import * as turf from "@turf/turf";
import wkx from "wellknown";
import polygonClipping from "polygon-clipping";

// Configuration
const SDA_CONFIG = {
  API_URL:
    "https://sdmdataaccess.nrcs.usda.gov/Tabular/SDMTabularService/post.rest",
  REQUEST_TIMEOUT: 45000,
  MAX_RETRIES: 3,
};

// Study area polygon (same as in the notebook)
// This polygon represents a specific agricultural area near Lawrence, Kansas
const studyAreaGeoJSON = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-95.320923, 39.587342], // Northwestern corner
            [-95.32088, 39.585573], // Start moving southeast
            [-95.312769, 39.580893], // Southeastern corner
            [-95.311654, 39.58119], // Start moving north
            [-95.311589, 39.582034], // Continue northward
            [-95.311611, 39.584283], // Moving to northwest
            [-95.311632, 39.587193], // Northwestern edge
            [-95.311868, 39.587408], // Western boundary
            [-95.314829, 39.587408], // Northern boundary
            [-95.319786, 39.587442], // Back to start area
            [-95.320923, 39.587342], // Close the polygon
          ],
        ],
      },
    },
  ],
};

// Helper functions
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sqmToAcres = (areaSqm) => areaSqm * 0.000247105381;

// Robust intersection calculation using multiple methods
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
async function executeSDQuery(query, options = {}) {
  const {
    format = "JSON",
    retries = SDA_CONFIG.MAX_RETRIES,
    timeout = SDA_CONFIG.REQUEST_TIMEOUT,
  } = options;

  const requestBody = { query: query.trim(), format };
  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(`Executing query (attempt ${attempt + 1}/${retries})...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(SDA_CONFIG.API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SDA API Error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      const results = data.Table || [];

      console.log(`✓ Query success: ${results.length} records returned`);
      return results;
    } catch (error) {
      lastError = error;

      if (error.name === "AbortError") {
        throw new Error(
          "Query timeout - try reducing scope or increasing timeout"
        );
      }

      if (attempt < retries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`Retry ${attempt + 1} after ${delay}ms...`);
        await wait(delay);
      }
    }
  }

  throw lastError;
}

// Convert GeoJSON to WKT format
function convertToWKT(geojson) {
  console.log("Converting GeoJSON to WKT format...");

  let geometry;
  if (geojson.type === "FeatureCollection" && geojson.features?.length > 0) {
    geometry = geojson.features[0].geometry;
  } else if (geojson.type === "Feature") {
    geometry = geojson.geometry;
  } else {
    geometry = geojson;
  }

  const wktString = wkx.stringify(geometry);
  console.log(`✓ Converted to WKT: ${wktString.length} characters`);

  return { geometry, wktString };
}

// Step 1: Get soil map unit keys (MUKEYs)
async function getSoilMapUnitKeys(wktString) {
  console.log("\n=== Step 1: Getting Soil Map Unit Keys ===");

  const mukeyQuery = `SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${wktString}')`;

  const mukeyData = await executeSDQuery(mukeyQuery);
  const mukeys = mukeyData
    .map((row) => String(row[0]))
    .filter((key) => key && key.trim());

  console.log(`Found ${mukeys.length} soil map units intersecting study area:`);
  console.log(mukeys);

  return mukeys;
}

// Step 2: Get comprehensive soil properties
async function getSoilProperties(mukeys) {
  console.log("\n=== Step 2: Getting Soil Properties ===");

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
            -- Ranking system to get the most representative soil data:
            -- 1. Highest component percentage (most dominant soil in the map unit)
            -- 2. Shallowest horizon depth (surface soil properties)
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

  const soilData = await executeSDQuery(soilPropertiesQuery);

  // Convert to object format
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
      area_acres: 0, // Will be calculated during spatial analysis
    };
  });

  console.log(
    `✓ Retrieved soil properties for ${
      Object.keys(soilProperties).length
    } map units`
  );
  return soilProperties;
}

// Step 3: Get polygon geometries and calculate intersections
async function calculateSoilIntersections(
  mukeys,
  studyAreaWkt,
  studyAreaGeometry,
  soilProperties
) {
  console.log("\n=== Step 3: Calculating Spatial Intersections ===");

  const results = [];
  let processed = 0;

  for (const mukey of mukeys) {
    try {
      console.log(
        `Processing soil unit ${mukey} (${processed + 1}/${mukeys.length})...`
      );

      // Get polygon data for this map unit
      const polygonQuery = `SELECT * FROM SDA_Get_MupolygonWktWgs84_from_Mukey(${mukey})`;
      const polygonData = await executeSDQuery(polygonQuery);

      if (polygonData.length === 0) {
        console.log(`  No polygon data for MUKEY ${mukey}`);
        processed++;
        continue;
      }

      let totalIntersectionArea = 0;
      const intersectionFeatures = [];

      // Process each polygon for this map unit
      for (const [wktPolygon] of polygonData) {
        try {
          // Parse the WKT polygon
          const soilGeometry = wkx.parse(wktPolygon);

          // Validate the geometry before proceeding
          if (
            !soilGeometry ||
            !soilGeometry.type ||
            !soilGeometry.coordinates
          ) {
            console.log(`    ✗ Invalid soil geometry for polygon`);
            continue;
          }

          console.log(
            `    Processing polygon: ${soilGeometry.type} with ${
              soilGeometry.coordinates?.length || 0
            } coordinate rings`
          );

          // Direct implementation of Python notebook approach:
          // if soil_polygon_geometry.intersects(wkt.loads(study_area_wkt)):
          //     intersection_geometry = soil_polygon_geometry.intersection(wkt.loads(study_area_wkt))

          let intersection = null;
          let intersectionMethod = "";

          try {
            // Create turf features with explicit validation
            let soilFeature, studyFeature;

            try {
              soilFeature = {
                type: "Feature",
                properties: {},
                geometry: soilGeometry,
              };

              studyFeature = {
                type: "Feature",
                properties: {},
                geometry: studyAreaGeometry,
              };

              // Validate the features have valid geometries
              if (
                !soilFeature?.geometry?.coordinates ||
                !studyFeature?.geometry?.coordinates
              ) {
                throw new Error("Invalid geometry coordinates");
              }
            } catch (featureError) {
              console.log(
                `      ✗ Feature creation failed: ${featureError.message}`
              );
              continue;
            }

            // Check if geometries intersect (like Python's .intersects() method)
            let intersects = false;
            try {
              intersects = turf.booleanIntersects(soilFeature, studyFeature);
            } catch (intersectError) {
              console.log(
                `      ✗ Intersection check failed: ${intersectError.message}`
              );
              continue;
            }

            if (intersects) {
              console.log(
                `      ✓ Geometries intersect, calculating precise intersection...`
              );

              // Use robust intersection calculation (like Python's .intersection() method)
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
                console.log(
                  `      ✓ Intersection calculated: ${intersectionResult.area.toFixed(
                    1
                  )} sq meters (${intersectionMethod})`
                );
              } else {
                console.log(
                  `      ✗ No valid intersection found with any method`
                );
              }
            } else {
              console.log(`      ✗ No spatial intersection detected`);
            }
          } catch (geometricError) {
            console.log(
              `      ✗ Geometric calculation failed: ${geometricError.message}`
            );
          }

          // Process successful intersection
          if (intersection && intersection.geometry) {
            const areaSquareMeters = turf.area(intersection);
            const areaAcres = sqmToAcres(areaSquareMeters);

            // Use meaningful threshold (at least 0.0001 acres)
            if (areaAcres > 0.0001) {
              totalIntersectionArea += areaAcres;

              intersectionFeatures.push({
                type: "Feature",
                properties: {
                  mukey,
                  area_acres: areaAcres,
                  area_square_meters: areaSquareMeters,
                  intersection_method: intersectionMethod,
                },
                geometry: intersection.geometry,
              });

              console.log(
                `    ✓ Intersection: ${areaAcres.toFixed(
                  6
                )} acres (${intersectionMethod})`
              );
            }
          }
        } catch (polygonError) {
          console.warn(`    Error processing polygon: ${polygonError.message}`);
        }
      }

      // Add to results if we have intersections
      if (totalIntersectionArea > 0 && soilProperties[mukey]) {
        const soilUnit = {
          ...soilProperties[mukey],
          area_acres: totalIntersectionArea,
          intersectionFeatures,
        };

        results.push(soilUnit);
        console.log(
          `  ✓ Added soil unit ${mukey}: ${totalIntersectionArea.toFixed(
            3
          )} acres total`
        );
      }

      processed++;
    } catch (error) {
      console.error(`  Error processing MUKEY ${mukey}: ${error.message}`);
      processed++;
    }
  }

  // Sort by area (largest first)
  results.sort((a, b) => (b.area_acres || 0) - (a.area_acres || 0));

  const totalArea = results.reduce(
    (sum, unit) => sum + (unit.area_acres || 0),
    0
  );
  console.log(
    `✓ Spatial analysis complete: ${
      results.length
    } soil units, ${totalArea.toFixed(3)} total acres`
  );

  return results;
}

// Main execution function
async function main() {
  try {
    console.log("=================================================");
    console.log("US Soil Information Analysis - JavaScript Version");
    console.log("=================================================");

    // Convert GeoJSON to WKT
    const { geometry: studyAreaGeometry, wktString: studyAreaWkt } =
      convertToWKT(studyAreaGeoJSON);

    // Step 1: Get soil map unit keys
    const mukeys = await getSoilMapUnitKeys(studyAreaWkt);

    if (mukeys.length === 0) {
      console.log("No soil map units found for the study area");
      return;
    }

    // Step 2: Get soil properties
    const soilProperties = await getSoilProperties(mukeys);

    // Step 3: Calculate spatial intersections
    const results = await calculateSoilIntersections(
      mukeys,
      studyAreaWkt,
      studyAreaGeometry,
      soilProperties
    );

    // Display results
    console.log("\n=== FINAL RESULTS ===");
    console.log(`Total soil units found: ${results.length}`);

    if (results.length > 0) {
      const totalArea = results.reduce(
        (sum, unit) => sum + (unit.area_acres || 0),
        0
      );
      console.log(`Total area analyzed: ${totalArea.toFixed(3)} acres`);

      // Validate total area against study area
      const studyAreaTotal = turf.area(studyAreaGeometry);
      const studyAreaAcres = sqmToAcres(studyAreaTotal);
      console.log(`Study area size: ${studyAreaAcres.toFixed(3)} acres`);

      const coveragePercentage = (totalArea / studyAreaAcres) * 100;
      console.log(`Coverage: ${coveragePercentage.toFixed(1)}% of study area`);

      if (Math.abs(totalArea - studyAreaAcres) > 1.0) {
        console.warn(
          `⚠️  Warning: Total intersection area (${totalArea.toFixed(
            3
          )} acres) differs significantly from study area (${studyAreaAcres.toFixed(
            3
          )} acres)`
        );
        console.warn(
          `This could indicate overlapping soil units or missing coverage.`
        );
      } else {
        console.log(
          `✓ Total area matches study area within acceptable tolerance`
        );
      }

      console.log("\nSoil units by area:");
      results.forEach((unit, index) => {
        console.log(
          `${index + 1}. ${unit.muname || "Unknown"} (${unit.mukey})`
        );
        console.log(`   Area: ${unit.area_acres.toFixed(3)} acres`);
        console.log(`   Taxonomic Order: ${unit.taxorder || "N/A"}`);
        console.log(`   Drainage Class: ${unit.drainagecl || "N/A"}`);
        console.log(`   Texture: ${unit.texture || "N/A"}`);
        if (unit.ph1to1h2o_r) {
          console.log(`   pH: ${unit.ph1to1h2o_r}`);
        }
        if (unit.om_r) {
          console.log(`   Organic Matter: ${unit.om_r}%`);
        }
        console.log(
          `   Features: ${unit.intersectionFeatures?.length || 0} polygons`
        );
        console.log("");
      });

      // Save results to JSON file
      const outputData = {
        study_area: studyAreaGeoJSON,
        soil_analysis: {
          total_area_acres: totalArea,
          mapunit_count: results.length,
          mapunits: results.map((unit) => ({
            mukey: unit.mukey,
            muname: unit.muname,
            area_acres: unit.area_acres,
            taxorder: unit.taxorder,
            taxsuborder: unit.taxsuborder,
            drainagecl: unit.drainagecl,
            texture: unit.texture,
            ph1to1h2o_r: unit.ph1to1h2o_r,
            om_r: unit.om_r,
            sandtotal_r: unit.sandtotal_r,
            silttotal_r: unit.silttotal_r,
            claytotal_r: unit.claytotal_r,
            intersection_features: unit.intersectionFeatures,
          })),
        },
      };

      // // Write to file
      // const fs = await import("fs");
      // const outputPath = "soil_analysis_results.json";
      // fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
      // console.log(`Results saved to: ${outputPath}`);
    }
  } catch (error) {
    console.error("Error in soil analysis:", error);
    process.exit(1);
  }
}

// Run the analysis
main();
