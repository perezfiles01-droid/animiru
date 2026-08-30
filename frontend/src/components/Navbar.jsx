import React from 'react';
import { Link } from 'react-router-dom';
import SearchBar from './SearchBar';
import '../styles/Navbar.css';

/**
 * The top bar: identity and search.
 *
 * Navigation lives in BottomNav rather than here. It used to be a link in
 * this bar, which a media query hid below 768px next to a menu button that
 * had been removed - so Settings was unreachable on a phone.
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

      </div>
    </nav>
  );
}
