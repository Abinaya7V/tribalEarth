# Security Notes

## Protected 
- **Authentication & Authorization**: All `/api/claims` routes, document downloads, and `/api/stats` require a valid JWT bearer token.
- **Role-Based Access Control**: 
  - Applicants can only view and read claims they explicitly created (`ownerId`). 
  - Officers (Gram Sabha, SDLC, DLC) can only view and act on claims currently situated in their respective stage.
- **Geo-Endpoints and Privacy**: 
  - Location and geometry data (`GET /api/claims/:id/geo`) is strictly governed by the same read permissions as claims.
  - The map interface only shows nearby claims that the logged-in officer has explicit authorization to see in full; all other nearby claims are aggressively anonymized to generic dots without personal metadata.
  - Map tiles rely on external CDNs (Leaflet, OpenStreetMap, Esri) configured centrally in `mapConfig.js`, but all geometry validation runs offline on the server.
- **Document Access**: Uploaded files have been moved out of `express.static` and now require an authenticated download endpoint (`/api/claims/:id/documents/:docId`) which validates both path traversal and claim read access.
- **File Names**: Documents are stored using unguessable random UUIDs to prevent enumeration.
- **Rate Limiting**: Applied to `/api/auth/login` to prevent brute forcing.

## Open / Risks (Accepted for Current Phase)
- **Demo-Grade Auth**: Sessions are stored in-memory and lost on restart. Passwords are hardcoded demo accounts.
- **No Password Reset / Registration**: Handled via out-of-band means for now.
- **JSON File Storage**: Still using `claims.json` instead of a relational DB. Handled with atomic writes.
- **External Bhashini API**: Calls are made without deep input sanitation beyond what Bhashini handles natively.
- **PDF OCR**: Vulnerable to complex PDFs or denial of service on very large documents since `tesseract.js` operates locally.
