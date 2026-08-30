import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import BottomNav from './components/BottomNav';
import Home from './pages/Home';
import Library from './pages/Library';
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
            <Route path="/settings" element={<Settings />} />
            <Route path="/settings/extensions" element={<ExtensionSettings />} />
            <Route path="/settings/update" element={<UpdateSettings />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
    </Router>
  );
}
