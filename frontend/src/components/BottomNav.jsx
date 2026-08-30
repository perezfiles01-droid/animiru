import React from 'react';
import { NavLink } from 'react-router-dom';
import '../styles/BottomNav.css';

/**
 * The app's primary navigation.
 *
 * It exists because the previous arrangement put Settings in a top bar that
 * a media query hid below 768px, alongside a menu button that had been
 * removed - so on a phone, the only screen that decides what the app can
 * show was unreachable without typing its URL.
 *
 * A bar rather than a menu: a handful of destinations do not justify
 * something that has to be opened first, and along the bottom edge they are
 * all within reach of a thumb.
 */

const DESTINATIONS = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/library', label: 'Library', icon: '♥', end: false },
  { to: '/settings', label: 'Settings', icon: '⚙️', end: false }
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {DESTINATIONS.map((destination) => (
        <NavLink
          key={destination.to}
          to={destination.to}
          // Without `end`, Home would stay highlighted everywhere, since
          // every route begins with "/".
          end={destination.end}
          className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}
        >
          <span className="bottom-nav-icon" aria-hidden="true">{destination.icon}</span>
          <span className="bottom-nav-label">{destination.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
