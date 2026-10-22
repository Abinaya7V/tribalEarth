// Configuration for Map Verification Support

window.MapConfig = {
  // Free street map provider (OpenStreetMap)
  streetTiles: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  },
  
  // Free satellite map provider (Esri World Imagery)
  satelliteTiles: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  },

  // Optional Official Boundary Overlay (GeoJSON URL or WMS)
  // Set to empty by default. Can be configured to load an official forest/village boundary layer.
  // e.g. { type: 'geojson', url: '/api/boundaries/forest' }
  officialOverlay: null
};
