# Animiru - Anime Streaming Platform

Animiru is a full-stack anime streaming and tracking application built with React, Express, and Firebase. Browse trending anime, search for your favorite shows, watch episodes with adaptive quality streaming, and maintain a personal watchlist.

## Features

- 🎬 **Stream Anime** - Watch episodes with adaptive quality streaming (Auto/1080p/720p/480p)
- 🔍 **Search & Browse** - Discover anime using AniList API with advanced search
- 📊 **Detailed Information** - View comprehensive anime details including genres, ratings, studios, and synopses
- 📝 **Watchlist Management** - Keep track of anime you're watching with rating and status tracking
- 👤 **User Profiles** - Personalized profiles with preferences (theme, quality, language) and watch history
- 📱 **Progressive Web App** - Install as a native app on any device
- 🚀 **Fast Performance** - Optimized backend with caching and efficient API calls

## Tech Stack

**Frontend:**
- React 18.2.0
- React Router v6
- Axios for HTTP requests
- HLS.js for adaptive video streaming
- CSS3 with responsive design

**Backend:**
- Node.js & Express
- Firebase/Firestore for database
- JWT authentication
- AniList GraphQL API integration

**Deployment:**
- GitHub Actions CI/CD
- Vercel for PWA hosting
- GitHub Releases for APK distribution

**Mobile:**
- React Native / Expo
- APK-only deployment

## Project Structure

```
animiru-app-fork/
├── frontend/                 # React frontend application
│   ├── public/              # Static assets
│   │   ├── index.html       # Main HTML entry point
│   │   ├── manifest.json    # PWA manifest
│   │   └── icons/           # App icons for PWA
│   ├── src/
│   │   ├── components/      # Reusable React components
│   │   │   ├── Navbar.jsx
│   │   │   ├── SearchBar.jsx
│   │   │   ├── AnimeCard.jsx
│   │   │   ├── VideoPlayer.jsx
│   │   │   └── Profile.jsx
│   │   ├── pages/           # Page components
│   │   │   ├── Home.jsx
│   │   │   ├── Browse.jsx
│   │   │   ├── Details.jsx
│   │   │   ├── Watch.jsx
│   │   │   └── Profile.jsx
│   │   ├── hooks/           # Custom React hooks
│   │   │   └── useAuth.js
│   │   ├── services/        # API services
│   │   │   └── api.js
│   │   ├── styles/          # CSS styling
│   │   │   ├── App.css
│   │   │   ├── Navbar.css
│   │   │   ├── SearchBar.css
│   │   │   ├── AnimeCard.css
│   │   │   ├── Pages.css
│   │   │   └── VideoPlayer.css
│   │   ├── App.js
│   │   └── index.js
│   └── package.json
├── backend/                  # Express backend API
│   ├── routes/              # API route handlers
│   │   ├── anime.js         # Anime search & details
│   │   ├── auth.js          # Authentication
│   │   ├── user.js          # User profiles
│   │   ├── watchlist.js     # Watchlist CRUD
│   │   └── health.js        # Health checks
│   ├── server.js            # Express server
│   ├── package.json
│   └── tests/               # Unit tests
├── mobile/                  # Mobile/APK configuration
│   └── build.gradle
├── .github/
│   └── workflows/
│       └── build-deploy.yml # CI/CD pipeline
├── docs/                    # Documentation
├── .env.example             # Environment variables template
└── README.md                # This file
```

## Getting Started

### Prerequisites

- Node.js 16+ and npm
- Firebase project with Firestore enabled
- AniList API access

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/animiru.git
   cd animiru
   ```

2. **Setup environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials:
   # - Firebase configuration
   # - JWT secret
   # - API URLs
   ```

3. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   ```

4. **Install frontend dependencies**
   ```bash
   cd ../frontend
   npm install
   ```

### Running Locally

**Start the backend server:**
```bash
cd backend
npm start
# Server runs on http://localhost:3001
```

**In another terminal, start the frontend:**
```bash
cd frontend
npm start
# App runs on http://localhost:3000
```

### Building for Production

**Build frontend:**
```bash
cd frontend
npm run build
# Creates optimized build in frontend/build/
```

**Deploy to Vercel (PWA):**
```bash
npm install -g vercel
vercel
# Follow prompts to deploy
```

**Build APK for mobile:**
```bash
cd mobile
./gradlew assembleRelease
# Creates .apk file in mobile/app/release/
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user info

### Anime
- `GET /api/anime/search?q=naruto&page=1` - Search anime
- `GET /api/anime/:id` - Get anime details
- `GET /api/anime/browse/trending` - Get trending anime

### User
- `GET /api/user/profile` - Get user profile
- `PUT /api/user/preferences` - Update preferences
- `GET /api/user/watch-history` - Get watch history

### Watchlist
- `GET /api/watchlist` - Get user's watchlist
- `POST /api/watchlist` - Add anime to watchlist
- `PUT /api/watchlist/:animeId` - Update watchlist item
- `DELETE /api/watchlist/:animeId` - Remove from watchlist

### Health
- `GET /api/health` - Health check

## Configuration

### Environment Variables

See `.env.example` for all available options. Key variables:

- `API_BASE_URL` - Backend API URL
- `REACT_APP_API_URL` - Frontend API URL
- `FIREBASE_*` - Firebase credentials
- `JWT_SECRET` - Secret for JWT signing
- `NODE_ENV` - Environment (development/production)

## Features Breakdown

### Home Page
- Displays trending anime in a responsive grid
- One-click navigation to anime details

### Browse Page
- Full-text search of anime database
- Pagination support
- Grid view with quick filters

### Details Page
- Complete anime information
- High-quality poster and banner images
- Episode count, status, and rating
- Studio information
- Genre tags
- Full synopsis
- Watch Now and Watchlist buttons

### Watch Page
- Full-featured video player
- Episode selector grid
- Adaptive quality streaming (Auto/1080p/720p/480p)
- Play/pause controls
- Progress bar with seeking
- Volume control
- Fullscreen support
- Time display (current/duration)

### Profile Page
- User preference settings:
  - Theme (dark/light/auto)
  - Video quality (1080p/720p/480p/auto)
  - Language (en/es/fr/ja)
- Personal watchlist display
- Remove items from watchlist
- Rating and status management

## Performance Optimizations

- **API Caching** - Anime data cached for 1 hour to reduce API calls
- **Image Optimization** - Responsive images with lazy loading
- **Code Splitting** - Route-based code splitting with React Router
- **Compression** - Gzip compression on backend responses
- **Rate Limiting** - API rate limiting to prevent abuse
- **CDN Ready** - Static assets optimized for CDN delivery

## Mobile Deployment

### PWA Installation
1. Open the app in a mobile browser
2. Tap menu → "Add to Home Screen" or "Install"
3. App installs as native-like application

### APK Installation
1. Download APK from GitHub Releases
2. Enable "Unknown Sources" in Settings (Android)
3. Open APK file and tap Install
4. App is ready to use

## Testing

### Run backend tests
```bash
cd backend
npm test
```

### Run frontend tests (if configured)
```bash
cd frontend
npm test
```

## Continuous Integration

The project uses GitHub Actions for:
- Linting and code quality checks
- Running test suites
- Building frontend and backend
- Generating APK releases
- Deploying to Vercel

CI configuration: `.github/workflows/build-deploy.yml`

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see LICENSE file for details.

## Support

For issues, questions, or suggestions, please open an issue on GitHub or contact the maintainers.

## Acknowledgments

- AniList API for anime data
- Firebase for authentication and database
- React community for excellent documentation
- All contributors who have helped improve this project

---

**Status:** Active Development

**Last Updated:** August 2026

**Live Demo:** https://perezfiles01-droid.github.io/Jim/

**Download APK:** https://github.com/perezfiles01-droid/animiru/releases
