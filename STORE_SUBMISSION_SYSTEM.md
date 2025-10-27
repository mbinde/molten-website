# Store Submission System

This document describes the web-based store submission and approval system for the Molten iOS app.

## Overview

The store submission system allows the glass artist community to submit local glass supply stores for inclusion in the Molten app. All submissions go through an admin approval queue to ensure quality and accuracy before being added to the app's public store directory.

## Architecture

### Public Submission Form
- **URL**: `/submit-store`
- **Location**: `src/pages/submit-store.astro`
- **Purpose**: Public-facing form for community members to submit glass stores
- **Fields**:
  - Required: name, address, city, state, ZIP
  - Optional: phone, website, notes, address line 2, submitter name/email

### Admin Approval Queue
- **URL**: `/admin/stores`
- **Location**: `src/pages/admin/stores.astro`
- **Purpose**: Admin interface to review, approve, or reject store submissions
- **Authentication**: JWT token-based with bcrypt password hashing
- **Security**: IP-based rate limiting with automatic lockdown
- **Features**:
  - View all submissions (pending, approved, rejected)
  - Approve/reject individual submissions (with automatic geocoding)
  - Generate final `stores.json` from approved stores
  - Statistics dashboard
  - Automatic session management (24h tokens)

### API Endpoints

#### POST `/api/submit-store`
- **Location**: `src/pages/api/submit-store.ts`
- **Purpose**: Handle public store submissions
- **Validation**: Required fields, state format (2 letters), ZIP format
- **Output**: Saves to `public/data/pending-stores.json`
- **ID Generation**: Creates `stable_id` slug from store name

#### POST `/api/approve-store`
- **Location**: `src/pages/api/approve-store.ts`
- **Purpose**: Mark a submission as approved
- **Input**: `{ stable_id: string }`
- **Output**: Updates status in `pending-stores.json`

#### POST `/api/reject-store`
- **Location**: `src/pages/api/reject-store.ts`
- **Purpose**: Mark a submission as rejected
- **Input**: `{ stable_id: string }`
- **Output**: Updates status in `pending-stores.json`

#### POST `/api/generate-stores`
- **Location**: `src/pages/api/generate-stores.ts`
- **Purpose**: Generate final `stores.json` from all approved stores
- **Output**: Creates/updates `public/stores.json` with approved stores
- **Note**: Coordinates set to 0.0 unless manually added to submission

## Data Storage

### Pending Submissions
- **File**: `public/data/pending-stores.json`
- **Format**:
```json
{
  "version": "1.0",
  "submissions": [
    {
      "stable_id": "store-name-slug",
      "name": "Store Name",
      "address_line1": "123 Main St",
      "city": "Seattle",
      "state": "WA",
      "zip": "98101",
      "phone": "(206) 555-1234",
      "website_url": "https://example.com",
      "notes": "Notes about the store",
      "submitted_at": "2025-10-26T12:00:00Z",
      "status": "pending",
      "submitter": {
        "name": "John Doe",
        "email": "john@example.com"
      }
    }
  ]
}
```

### Public Store Directory
- **File**: `public/stores.json`
- **Consumed by**: Molten iOS app (loaded on first launch)
- **Format**: See `Molten/Sources/Resources/stores.json` for structure
- **Generated**: Manually via admin interface "Generate stores.json" button

## Workflow

### 1. Community Submission
1. User visits `/submit-store`
2. Fills out form with store details
3. Clicks "Submit Store"
4. JavaScript posts to `/api/submit-store`
5. API validates data and saves to `pending-stores.json`
6. User sees success message

### 2. Admin Review & Auto-Geocoding
1. Admin visits `/admin/stores`
2. Enters password (default: `molten-admin-2025`, set via `ADMIN_PASSWORD` env var)
3. Reviews pending submissions
4. For each submission:
   - Click "✓ Approve" → POST to `/api/approve-store`
     - **Automatically geocodes** address using Nominatim (OpenStreetMap)
     - Adds latitude/longitude to submission
     - Free, no API key needed, 1 req/sec rate limit (perfect for manual approvals)
   - Click "✗ Reject" → POST to `/api/reject-store`

### 3. Publishing to App
1. Admin clicks "Generate stores.json from Approved Stores"
2. System POST to `/api/generate-stores`
3. API filters approved stores, transforms format, saves to `public/stores.json`
4. File is now available at `https://yourdomain.com/stores.json`
5. iOS app will fetch this on first launch or when manually refreshed

## iOS App Integration

The iOS app loads stores from the generated `stores.json` file:

- **Initial Load**: `StoreListView` checks if local store count is 0
- **If empty**: Calls `storeService.loadStoresFromBundleResource(filename: "stores")`
- **Bundle fallback**: Ships with `Molten/Sources/Resources/stores.json` embedded in app
- **Future**: Could periodically fetch updated stores.json from website

### Updating the iOS Bundle

When you regenerate `stores.json` on the website, you should also update the iOS app's bundled version:

```bash
# Copy website's stores.json to iOS bundle
cp /path/to/molten-website/public/stores.json /path/to/Molten/Sources/Resources/stores.json

# Rebuild and test the app
cd /path/to/Molten
xcodebuild -project Molten.xcodeproj -scheme Molten build
```

## Setup & Configuration

### Environment Variables

Create a `.env` file in the website root:

```bash
ADMIN_PASSWORD=your-secure-password-here
```

### Deployment

Since this is an Astro static site, API routes run as serverless functions. Ensure your hosting platform supports:
- Node.js API routes
- File system access for JSON storage
- Environment variables

**Supported platforms**: Netlify, Vercel, Cloudflare Pages (with Workers)

### Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Visit forms
http://localhost:4321/submit-store
http://localhost:4321/admin/stores
```

## Geocoding

### Automatic Geocoding on Approval

When you approve a store, the system automatically geocodes the address using **Nominatim** (OpenStreetMap):

- **Free** - No API key required
- **Rate limit**: 1 request/second (fine for manual approvals)
- **Accuracy**: Generally excellent for US addresses
- **Fallback**: If geocoding fails, stores default to 0,0 (iOS app handles gracefully)

The geocoding happens in `/api/approve-store.ts` and adds `latitude` and `longitude` to the store record.

**How it works:**
1. You click "✓ Approve"
2. API constructs full address string
3. Calls Nominatim API (free OpenStreetMap service)
4. Saves coordinates to `pending-stores.json`
5. Later, "Generate stores.json" uses those saved coordinates

**Nominatim Usage Policy**: https://operations.osmfoundation.org/policies/nominatim/
- Requirement: Provide User-Agent header ✅ (we do this)
- Rate limit: 1 request/second maximum ✅ (manual approvals are slower)
- No bulk geocoding ✅ (only ~100 stores total)

## Limitations & Future Improvements

### Current Limitations

1. **Manual Publishing**: Admin must click "Generate stores.json" button
   - **Improvement**: Auto-publish on approval, or scheduled builds

4. **No Email Notifications**: Submitters don't get confirmation emails
   - **Improvement**: Integrate email service (SendGrid, AWS SES)

### Recommended Improvements

#### Add Server-Side Authentication
Create a middleware to protect admin routes with real session management.

#### Auto-Publish on Approval
Modify `/api/approve-store` to automatically regenerate `stores.json` after each approval.

## Troubleshooting

### Submissions not appearing
- Check `public/data/pending-stores.json` was created
- Verify API endpoint is accessible: `curl http://localhost:4321/api/submit-store`
- Check browser console for JavaScript errors

### Admin password not working
- Verify `.env` file exists and has `ADMIN_PASSWORD` set
- Check that Astro is loading environment variables (dev server restart required)
- Check browser console for hardcoded password value

### stores.json not updating
- Verify approved stores exist in `pending-stores.json`
- Check `/api/generate-stores` endpoint returns success
- Verify file permissions on `public/stores.json`

## Support

For questions or issues:
- Email: info@moltenglass.app
- Check server logs for API errors
- Verify JSON file structure matches expected format

---

**Created**: October 26, 2025
**Version**: 1.0
