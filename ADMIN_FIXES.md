# Admin Section Fixes

This document records the recent fixes applied to the Admin Section across the frontend and backend to ensure stability and correct data representation.

## Backend Changes (`party-admin-backend`)

### 1. Actual Revenue Calculation
- **Files Affected**: 
  - `src/controllers/admin.controller.js`
  - `src/controllers/analytics.controller.js`
- **Issue**: The Admin Dashboard and Analytics Net Revenue were previously only calculating `Booking` (event tickets) revenue, completely ignoring `FoodOrder` revenue.
- **Fix**: Added parallel aggregation for `FoodOrder` where `status` is `completed` or `out_for_delivery`. Both revenues (tickets + food) are now summed up as `totalRevenue`. The UI now correctly displays the true full revenue. 

### 2. Admin Profile Synchronization
- **Files Affected**: 
  - `src/routes/admin.routes.js`
  - `src/controllers/admin.controller.js`
- **Issue**: When an admin logged into a new device, their previously uploaded profile image and name did not load because there was no backend endpoint to retrieve their profile data upon app start.
- **Fix**: Created the `GET /api/admin/profile` endpoint inside `admin.routes.js` and implemented `getAdminProfile` controller to return the admin's `name` and `profileImage` from the database. Added a 5-minute Redis cache layer for speed.

## Frontend Changes (`mobile`)

### 1. Keyboard Avoiding in Admin Settings
- **Files Affected**: 
  - `src/app/admin/settings.tsx`
- **Issue**: The bottom-sheet modal for updating the admin's name and identity image would get blocked/covered by the system keyboard on iOS and Android when typing.
- **Fix**: Wrapped the modal inner contents with `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>`. Replaced invalid CSS string props (`color="#FFF"`) on text inputs with proper React Native StyleSheet references.

### 2. Admin Profile Auto-Sync on Login/Boot
- **Files Affected**: 
  - `src/context/AuthContext.tsx`
  - `src/services/adminService.ts`
- **Issue**: The app used a hardcoded bypass token for testing on local devices, leaving `user={null}`.
- **Fix**: Upgraded the core `AuthContext` boot loop. If the active session is detected as `admin`, it now automatically triggers a rapid prefetch to `GET /admin/profile` 500ms after boot, silently syncing the database profile image and name into the application state. Admin avatars and names now stay identical across devices. 

---
*Run `git commit -m "fix(admin): overall dashboard revenue, profile sync, UI keyboard layout constraints"` to push all these upgrades.*
