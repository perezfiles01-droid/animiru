import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/Navbar.css';

/**
 * The top bar: the app's identity, and nothing else.
 *
 * Navigation lives in BottomNav rather than here. It used to be a link in
 * this bar, which a media query hid below 768px next to a menu button that
 * had been removed - so Settings was unreachable on a phone.
 *
 * Search used to live here as well, which put two search boxes on screen at
 * once: this one, and the one on the page below it. They did not share a
 * value, so which of the two you had typed into decided whether the source
 * filter beside it applied. One bar, on the page it searches.
 */
export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-container">
        <Link to="/" className="navbar-logo">
          <span className="logo-icon">🎌</span>
          <span className="logo-text">Animiru</span>
        </Link>

      </div>
    </nav>
  );
}
