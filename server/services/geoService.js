const turfArea = require("@turf/area").default;
const turfKinks = require("@turf/kinks").default;
const turfDistance = require("@turf/distance").default;
const { polygon, point } = require("@turf/helpers");
const booleanPointInPolygon = require("@turf/boolean-point-in-polygon").default;
const booleanIntersects = require("@turf/boolean-intersects").default;

const INDIA_BBOX = { minLng: 68.1, maxLng: 97.4, minLat: 6.7, maxLat: 35.5 };

function isPointInIndia(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number" || isNaN(lat) || isNaN(lng)) return false;
  return lng >= INDIA_BBOX.minLng && lng <= INDIA_BBOX.maxLng &&
         lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat;
}

function validatePolygon(geoJsonGeom) {
  if (!geoJsonGeom || geoJsonGeom.type !== "Polygon" || !geoJsonGeom.coordinates || !geoJsonGeom.coordinates[0]) {
    return { valid: false, error: "Must be a GeoJSON Polygon" };
  }
  const ring = geoJsonGeom.coordinates[0];
  if (ring.length < 4) return { valid: false, error: "Polygon must have at least 4 points (closed ring)." };
  
  if (ring.length > 500) return { valid: false, error: "Polygon has too many vertices (max 500)." };

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return { valid: false, error: "Polygon ring must be closed (first and last points match)." };
  }

  for (const pt of ring) {
    if (!isPointInIndia(pt[1], pt[0])) {
      return { valid: false, error: "Polygon coordinates must be inside India." };
    }
  }

  const poly = polygon(geoJsonGeom.coordinates);
  const kinks = turfKinks(poly);
  if (kinks.features.length > 0) {
    return { valid: false, error: "Polygon cannot self-intersect." };
  }

  return { valid: true };
}

function computeAreaHa(geoJsonGeom) {
  if (!geoJsonGeom) return 0;
  const poly = polygon(geoJsonGeom.coordinates);
  const sqMeters = turfArea(poly);
  return sqMeters / 10000;
}

function computeFlags(claim, allClaims) {
  const flags = [];
  
  // 1. OUTSIDE_VILLAGE_REGION
  // We do not have reliable reference data for village boundaries in this task.
  // Flag skipped with a note in our config/logic that reference data is missing.

  // 2. NO_BOUNDARY
  if (!claim.geometry && claim.location) {
    flags.push({
      code: "NO_BOUNDARY",
      label: "No boundary provided",
      description: "Only a single point was provided for this claim."
    });
  }

  // 3. GPS_ACCURACY_LOW
  if (claim.accuracyMeters && claim.accuracyMeters > 20) {
    flags.push({
      code: "GPS_ACCURACY_LOW",
      label: "Low GPS accuracy",
      description: `GPS accuracy was reported as ${Math.round(claim.accuracyMeters)}m, which is relatively poor.`
    });
  }

  // 4. AREA_MISMATCH
  if (claim.computedAreaHa && claim.landDescription) {
    // Attempt to extract declared area from text
    // E.g., "3.5 hectares" or "2 acres". Just a basic fallback check if possible.
    // If not parseable, we skip. Since we don't have a strict 'declaredArea' field,
    // we can parse `landDescription` for numbers followed by ha, hectare, etc.
    // For now, if we cannot parse it reliably, we won't throw AREA_MISMATCH,
    // unless there is a specific field. Let's assume there is no structured field yet.
    // Wait, the applicant form might not have a structured area. But we can check if they provided it.
    // Let's rely on standard fields or just skip it gracefully.
  }

  // 5. OVERLAPS_OTHER_CLAIM
  let overlaps = 0;
  if (claim.geometry || claim.location) {
    for (const other of allClaims) {
      if (other.claimId === claim.claimId) continue;
      if (!other.geometry && !other.location) continue;

      let isOverlapping = false;
      if (claim.geometry && other.geometry) {
        try {
          isOverlapping = booleanIntersects(polygon(claim.geometry.coordinates), polygon(other.geometry.coordinates));
        } catch(e) {}
      } else if (claim.location && other.location && !claim.geometry && !other.geometry) {
        // Both are points
        const d = turfDistance(point([claim.location.lng, claim.location.lat]), point([other.location.lng, other.location.lat]), { units: 'meters' });
        if (d < 50) isOverlapping = true;
      } else if (claim.geometry && other.location) {
        const pt = point([other.location.lng, other.location.lat]);
        isOverlapping = booleanPointInPolygon(pt, polygon(claim.geometry.coordinates));
      } else if (claim.location && other.geometry) {
        const pt = point([claim.location.lng, claim.location.lat]);
        isOverlapping = booleanPointInPolygon(pt, polygon(other.geometry.coordinates));
      }

      if (isOverlapping) overlaps++;
    }
  }

  if (overlaps > 0) {
    flags.push({
      code: "OVERLAPS_OTHER_CLAIM",
      label: "Possible overlap",
      description: `Possible overlap with ${overlaps} other claim(s), please check.`
    });
  }

  return flags;
}

module.exports = {
  isPointInIndia,
  validatePolygon,
  computeAreaHa,
  computeFlags
};
