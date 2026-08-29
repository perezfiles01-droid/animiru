import React from 'react';
import { Link } from 'react-router-dom';
import SearchBar from './SearchBar';
import '../styles/Navbar.css';

/**
 * Two destinations, which is all there is: what you are watching, and where
 * sources come from.
 *
 * No account area. Nothing in the app is per-user any more - installed
 * sources live on the device - so a login would guard nothing.
 */
export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">
          <span className="logo-icon">🎌</span>
          <span className="logo-text">Animiru</span>
        </Link>

        <SearchBar />

        <div className="nav-menu">
          <Link to="/settings" className="nav-link">Settings</Link>
        </div>
      </div>
    </nav>
  );
}
