import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Details from './pages/Details';
import Watch from './pages/Watch';
import Settings from './pages/Settings';
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
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
        <footer className="footer">
          <p>&copy; 2024 Animiru. Watch anime online.</p>
        </footer>
      </div>
    </Router>
  );
}
