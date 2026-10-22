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

function claimsOverlap(a, b) {
  if (!a || !b) return false;
  if (!a.geometry && !a.location) return false;
  if (!b.geometry && !b.location) return false;

  try {
    if (a.geometry && b.geometry) {
      return booleanIntersects(polygon(a.geometry.coordinates), polygon(b.geometry.coordinates));
    } else if (a.location && b.location && !a.geometry && !b.geometry) {
      const d = turfDistance(
        point([a.location.lng, a.location.lat]),
        point([b.location.lng, b.location.lat]),
        { units: "meters" }
      );
      return d < 50;
    } else if (a.geometry && b.location) {
      const pt = point([b.location.lng, b.location.lat]);
      return booleanPointInPolygon(pt, polygon(a.geometry.coordinates));
    } else if (a.location && b.geometry) {
      const pt = point([a.location.lng, a.location.lat]);
      return booleanPointInPolygon(pt, polygon(b.geometry.coordinates));
    }
  } catch (e) {
    return false;
  }
  return false;
}

function computeFlags(claim, allClaims) {
  const flags = [];
  
  // 1. OUTSIDE_VILLAGE_REGION
  // Skipped (reference data not available)

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

  // 4. AREA_MISMATCH (not implemented without structured declaredArea)

  // 5. OVERLAPS_OTHER_CLAIM
  let overlaps = 0;
  if (claim.geometry || claim.location) {
    for (const other of allClaims) {
      if (other.claimId === claim.claimId) continue;
      if (claimsOverlap(claim, other)) overlaps++;
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
  claimsOverlap,
  computeFlags
};

