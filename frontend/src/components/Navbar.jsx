import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import SearchBar from './SearchBar';
import '../styles/Navbar.css';

export default function Navbar({ user, onLogout }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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

          {user ? (
            <div className="user-menu">
              <Link to="/profile" className="nav-link user-name">
                {user.username}
              </Link>
              <button className="logout-btn" onClick={onLogout}>
                Logout
              </button>
            </div>
          ) : (
            <div className="auth-buttons">
              <Link to="/login" className="login-btn">Login</Link>
              <Link to="/register" className="register-btn">Sign Up</Link>
            </div>
          )}
        </div>

        <button
          className="menu-toggle"
          onClick={() => setIsMenuOpen(!isMenuOpen)}
        >
          ☰
        </button>
      </div>

      {isMenuOpen && (
        <div className="mobile-menu">
          <Link to="/settings" className="mobile-link" onClick={() => setIsMenuOpen(false)}>Settings</Link>
          {user && (
            <Link to="/profile" className="mobile-link" onClick={() => setIsMenuOpen(false)}>
              {user.username}
            </Link>
          )}
        </div>
      )}
    </nav>
  );
}
