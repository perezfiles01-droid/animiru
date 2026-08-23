# Animiru Testing & Quality Assurance Guide

Comprehensive testing procedures for the Animiru anime streaming platform across all platforms.

## Test Environment Setup

### Prerequisites

- Node.js 16+
- npm 8+
- Java 11+
- Android SDK (for APK testing)
- Chrome/Firefox/Safari (for browser testing)
- Git

### Installation

```bash
# Backend
cd backend
npm install
npm run lint
npm run test

# Frontend
cd frontend
npm install
npm run build
npm test

# Mobile
cd mobile/android
./gradlew clean assembleDebug
```

## Backend API Testing

### 1. Health Check

```bash
curl http://localhost:3001/api/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-08-23T13:00:00Z",
  "uptime": 1234567,
  "environment": "development"
}
```

### 2. Authentication Flow

**Register User:**
```bash
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@animiru.app",
    "password": "SecurePassword123!",
    "username": "testuser"
  }'
```

**Login:**
```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@animiru.app",
    "password": "SecurePassword123!"
  }'
```

**Get Current User:**
```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3001/api/auth/me
```

### 3. Anime API Testing

**Search Anime:**
```bash
curl "http://localhost:3001/api/anime/search?q=naruto&page=1"
```

**Get Trending:**
```bash
curl http://localhost:3001/api/anime/browse/trending
```

**Get Details:**
```bash
curl http://localhost:3001/api/anime/1
```

### 4. Watchlist CRUD Operations

**Get Watchlist:**
```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:3001/api/watchlist
```

**Add to Watchlist:**
```bash
curl -X POST http://localhost:3001/api/watchlist \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "animeId": 1,
    "status": "watching",
    "rating": 8
  }'
```

**Update Watchlist Item:**
```bash
curl -X PUT http://localhost:3001/api/watchlist/1 \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "rating": 9
  }'
```

**Remove from Watchlist:**
```bash
curl -X DELETE http://localhost:3001/api/watchlist/1 \
  -H "Authorization: Bearer TOKEN"
```

## Frontend UI Testing

### 1. Component Rendering

**Test Each Page:**
- [ ] Home Page - Trending anime grid loads
- [ ] Browse Page - Search functionality works
- [ ] Details Page - Anime info displays correctly
- [ ] Watch Page - Video player loads
- [ ] Profile Page - User settings display

### 2. Responsive Design

**Mobile (480px):**
- [ ] Navigation collapses to hamburger menu
- [ ] Video player responsive
- [ ] Text readable
- [ ] Touch targets 48px minimum

**Tablet (768px):**
- [ ] Two-column layouts work
- [ ] Buttons properly sized
- [ ] Images scale correctly

**Desktop (1024px+):**
- [ ] Full navigation bar visible
- [ ] Multi-column grids displayed
- [ ] All features accessible

### 3. Authentication Flow

- [ ] Login page displays
- [ ] Registration works
- [ ] JWT token stored in localStorage
- [ ] Protected routes redirect to login
- [ ] Logout clears token
- [ ] Session persists on refresh

### 4. API Integration

- [ ] Anime search returns results
- [ ] Pagination works correctly
- [ ] Anime details load
- [ ] Video player sources load
- [ ] Watchlist operations successful
- [ ] User preferences save

### 5. Performance Testing

```bash
# Lighthouse audit
npm audit
npm run build

# Check bundle size
ls -lh frontend/build/static/js/main.*.js
ls -lh frontend/build/static/css/main.*.css

# Expected sizes (gzipped):
# JS: < 100 KB
# CSS: < 5 KB
```

## Mobile APK Testing

### 1. Build Verification

```bash
# Debug build
./gradlew assembleDebug

# Verify APK created
ls -lh app/build/outputs/apk/debug/app-debug.apk
```

### 2. Installation Testing

```bash
# Install on emulator/device
adb install app/build/outputs/apk/debug/app-debug.apk

# Verify install
adb shell pm list packages | grep animiru
```

### 3. Functional Testing

- [ ] App launches without crashes
- [ ] Home page displays trending anime
- [ ] Search functionality works
- [ ] Video player plays content
- [ ] Login/registration flow works
- [ ] Watchlist operations successful
- [ ] Navigation works smoothly
- [ ] Back button functions correctly

### 4. Device Compatibility

**Test on:**
- [ ] Android 5.0 (API 21) - Minimum
- [ ] Android 9.0 (API 28) - Mid-range
- [ ] Android 13+ (API 33+) - Latest

### 5. Performance on Device

- [ ] Startup time < 3 seconds
- [ ] Video loads within 2 seconds
- [ ] Search responds within 1 second
- [ ] Memory usage stable
- [ ] Battery drain acceptable
- [ ] Storage < 50 MB

## Security Testing

### 1. Authentication Security

- [ ] Passwords hashed properly
- [ ] JWT tokens expire correctly
- [ ] Invalid tokens rejected
- [ ] 401 errors redirect to login
- [ ] Tokens not logged in console

### 2. API Security

- [ ] HTTPS enforced in production
- [ ] CORS properly configured
- [ ] Rate limiting works (>100 req/15min denied)
- [ ] Input validation on all endpoints
- [ ] SQL injection prevented
- [ ] XSS protection active

### 3. Data Security

- [ ] User data not exposed
- [ ] Passwords not returned in API
- [ ] Sensitive logs removed
- [ ] No hardcoded credentials
- [ ] Environment variables used

### 4. Network Security

- [ ] Certificate pinning active
- [ ] No cleartext traffic
- [ ] Secure storage for tokens
- [ ] API keys not exposed

## Browser Compatibility

**Supported Browsers:**
- [ ] Chrome 90+
- [ ] Firefox 88+
- [ ] Safari 14+
- [ ] Edge 90+

**Test:**
```bash
npm run build
npx serve -s build
# Open in each browser
```

## Accessibility Testing

- [ ] Keyboard navigation works
- [ ] Screen reader support
- [ ] Color contrast sufficient
- [ ] Focus indicators visible
- [ ] ARIA labels present
- [ ] Alt text on images

## Load Testing

### Backend Load Test

```bash
# Using artillery (npm install -g artillery)
artillery quick --count 100 --num 10 http://localhost:3001/api/anime/browse/trending
```

**Expected Results:**
- [ ] 100+ concurrent users supported
- [ ] Response time < 500ms (p95)
- [ ] Error rate < 0.1%
- [ ] No memory leaks

### Frontend Performance

```bash
# Lighthouse in Chrome DevTools
# Lighthouse > Generate report
```

**Expected Scores:**
- [ ] Performance: > 90
- [ ] Accessibility: > 90
- [ ] Best Practices: > 90
- [ ] SEO: > 90

## Continuous Integration Tests

### GitHub Actions

- [ ] Linting passes (ESLint)
- [ ] Build succeeds
- [ ] Tests pass (Jest)
- [ ] No security vulnerabilities
- [ ] Code coverage > 70%
- [ ] APK builds successfully

## Test Coverage

```bash
# Backend coverage
cd backend
npm run test -- --coverage

# Expected: > 70% functions covered
# Critical paths: > 90% covered
```

**Critical Paths to Test:**
- [ ] Authentication (login/register/logout)
- [ ] API endpoints (CRUD operations)
- [ ] Error handling
- [ ] Rate limiting
- [ ] Token validation

## Bug Reporting

**Format:**
```
Title: [Component] Brief description

Expected: What should happen
Actual: What actually happened
Steps:
1. Step 1
2. Step 2
3. Step 3

Environment:
- Platform: iOS/Android/Web
- Version: 1.0.0
- Device: Model
- OS: Version
```

## Sign-Off Checklist

- [ ] All manual tests passed
- [ ] CI/CD pipeline green
- [ ] Security tests passed
- [ ] Performance acceptable
- [ ] Browser compatibility verified
- [ ] Mobile APK tested
- [ ] Documentation updated
- [ ] No critical bugs
- [ ] Code review approved
- [ ] Ready for release

## Regression Testing

After each release:
- [ ] Re-test all critical paths
- [ ] Verify mobile compatibility
- [ ] Check API endpoints
- [ ] Validate UI rendering
- [ ] Confirm performance metrics

---

**Test Status:** Ready for QA  
**Last Updated:** August 2026  
**Version:** 1.0.0
