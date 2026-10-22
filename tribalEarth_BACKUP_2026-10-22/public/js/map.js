/**
 * Map Initialization and Drawing Logic for Filing Form and Officials Review
 */

// We keep global references so we can clean them up or interact with them
let filingMap = null;
let filingDrawControl = null;
let filingFeatureGroup = null;
let currentGeometry = null;

// Standard Map init helper
function initLeafletMap(containerId, options = {}) {
  const el = document.getElementById(containerId);
  if (!el) return null;
  
  // Clean up if already exists
  if (el._leaflet_id) {
    el._leaflet_id = null;
    el.innerHTML = '';
  }

  const map = L.map(containerId, {
    center: options.center || [20.5937, 78.9629], // Default to center of India
    zoom: options.zoom || 5,
    maxZoom: 19
  });

  // Base layers
  const streetLayer = L.tileLayer(window.MapConfig.streetTiles.url, {
    attribution: window.MapConfig.streetTiles.attribution,
    maxZoom: 19
  });

  const satLayer = L.tileLayer(window.MapConfig.satelliteTiles.url, {
    attribution: window.MapConfig.satelliteTiles.attribution,
    maxZoom: 19
  });

  streetLayer.addTo(map);

  const baseMaps = {
    "Streets": streetLayer,
    "Satellite": satLayer
  };

  L.control.layers(baseMaps).addTo(map);
  
  // Invalidate size in case container was hidden when initialized
  setTimeout(() => map.invalidateSize(), 200);

  return map;
}

// ----------------------------------------------------
// Applicant Filing Map
// ----------------------------------------------------

function initFilingMap() {
  if (filingMap) return; // Already initialized

  const mapEl = document.getElementById('filingMap');
  if (!mapEl) return;

  filingMap = initLeafletMap('filingMap', { zoom: 5 });
  
  filingFeatureGroup = new L.FeatureGroup();
  filingMap.addLayer(filingFeatureGroup);

  filingDrawControl = new L.Control.Draw({
    draw: {
      polyline: false,
      rectangle: false,
      circle: false,
      circlemarker: false,
      polygon: {
        allowIntersection: false, // Prevents self-intersecting polygons
        drawError: {
          color: '#e1e100',
          message: '<strong>Error:</strong> Polygon edges cannot cross.'
        },
        shapeOptions: { color: '#0055ff' }
      },
      marker: true
    },
    edit: {
      featureGroup: filingFeatureGroup,
      remove: true
    }
  });

  filingMap.addControl(filingDrawControl);

  filingMap.on(L.Draw.Event.CREATED, function (e) {
    // Clear previous drawing (allow only one marker OR polygon)
    filingFeatureGroup.clearLayers();
    
    const layer = e.layer;
    filingFeatureGroup.addLayer(layer);
    updateFilingFormFromMap(layer);
  });

  filingMap.on(L.Draw.Event.DELETED, function (e) {
    if (filingFeatureGroup.getLayers().length === 0) {
      clearFilingFormGeo();
    }
  });
  
  filingMap.on(L.Draw.Event.EDITED, function (e) {
    const layers = filingFeatureGroup.getLayers();
    if (layers.length > 0) {
      updateFilingFormFromMap(layers[0]);
    }
  });

  const locateBtn = document.getElementById('mapLocateBtn');
  if (locateBtn) {
    locateBtn.addEventListener('click', () => {
      if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
      }
      
      locateBtn.textContent = "Locating...";
      locateBtn.disabled = true;

      navigator.geolocation.getCurrentPosition(
        (position) => {
          locateBtn.textContent = "Use my current location";
          locateBtn.disabled = false;
          
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;
          const accuracy = position.coords.accuracy;
          
          filingMap.setView([lat, lng], 16);
          
          filingFeatureGroup.clearLayers();
          const marker = L.marker([lat, lng]).addTo(filingFeatureGroup);
          
          document.getElementById('latitude').value = lat.toFixed(6);
          document.getElementById('longitude').value = lng.toFixed(6);
          document.getElementById('locationSource').value = 'gps';
          document.getElementById('accuracyMeters').value = accuracy;
          document.getElementById('geometry').value = '';
          
          // Trigger visually reading aloud if needed? 
        },
        (error) => {
          locateBtn.textContent = "Use my current location";
          locateBtn.disabled = false;
          alert("Unable to retrieve your location. Please check browser permissions.");
        },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }
}

function updateFilingFormFromMap(layer) {
  if (layer instanceof L.Marker) {
    const latlng = layer.getLatLng();
    document.getElementById('latitude').value = latlng.lat.toFixed(6);
    document.getElementById('longitude').value = latlng.lng.toFixed(6);
    document.getElementById('geometry').value = '';
    document.getElementById('locationSource').value = 'map_click';
    document.getElementById('accuracyMeters').value = '';
  } else if (layer instanceof L.Polygon) {
    const geojson = layer.toGeoJSON();
    document.getElementById('geometry').value = JSON.stringify(geojson.geometry);
    // Approximate center
    const bounds = layer.getBounds();
    const center = bounds.getCenter();
    document.getElementById('latitude').value = center.lat.toFixed(6);
    document.getElementById('longitude').value = center.lng.toFixed(6);
    document.getElementById('locationSource').value = 'map_draw';
    document.getElementById('accuracyMeters').value = '';
  }
}

function clearFilingFormGeo() {
  document.getElementById('latitude').value = '';
  document.getElementById('longitude').value = '';
  document.getElementById('geometry').value = '';
  document.getElementById('locationSource').value = '';
  document.getElementById('accuracyMeters').value = '';
}

// Hook map invalidate size when tab changes (especially step 2)
document.addEventListener('DOMContentLoaded', () => {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      if (m.target.classList.contains('is-active') && m.target.dataset.step === "2") {
        initFilingMap();
        if (filingMap) {
          setTimeout(() => filingMap.invalidateSize(), 100);
        }
      }
    });
  });

  const step2 = document.querySelector('.form-step[data-step="2"]');
  if (step2) observer.observe(step2, { attributes: true, attributeFilter: ['class'] });
});

window.initFilingMap = initFilingMap;
