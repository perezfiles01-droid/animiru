import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import BottomNav from './components/BottomNav';
import Home from './pages/Home';
import Library from './pages/Library';
import History from './pages/History';
import WatchOrder from './pages/WatchOrder';
import Recommendations from './pages/Recommendations';
import TrackingSettings from './pages/TrackingSettings';
import Details from './pages/Details';
import Watch from './pages/Watch';
import Settings from './pages/Settings';
import ExtensionSettings from './pages/ExtensionSettings';
import UpdateSettings from './pages/UpdateSettings';
import './styles/App.css';

/**
 * Animiru: a player for sources you install yourself.
 *
 * Home is the installed source's catalogue, /anime one of its titles, and
 * /watch one episode. Both carry the source and the source's own id as
 * search params, because a scraper's ids are URLs and do not survive being
 * path segments.
 */
export default function App() {
  return (
    <Router>
      <div className="app">
        <Navbar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/anime" element={<Details />} />
            <Route path="/watch" element={<Watch />} />
            <Route path="/library" element={<Library />} />
            <Route path="/history" element={<History />} />
            <Route path="/watch-order" element={<WatchOrder />} />
            <Route path="/recommendations" element={<Recommendations />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/extensions" element={<ExtensionSettings />} />
            <Route path="/settings/update" element={<UpdateSettings />} />
            <Route path="/settings/tracking" element={<TrackingSettings />} />

            {/*
              Anything else goes to the front page rather than nowhere.

              <Routes> renders null when no path matches, and Navbar and
              BottomNav are outside it - so an unmatched path drew the app's
              frame around an empty middle, which reads as a crash and says
              nothing about what went wrong. The Android shell opened the app
              at /index.html, which is a file rather than a route, so that
              blank screen was the first thing every launch showed until the
              user tapped a tab.

              The shell now opens "/" and that is the real fix. This is here
              because a path that matches nothing must never again be a blank
              screen - a route renamed later, a mistyped link, or a URL
              restored from an older version all arrive here too.
            */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
    </Router>
  );
}
