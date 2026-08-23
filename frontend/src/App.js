import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import Browse from './pages/Browse';
import Details from './pages/Details';
import Watch from './pages/Watch';
import Library from './pages/Library';
import LibraryDetail from './pages/LibraryDetail';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import { useAuth } from './hooks/useAuth';
import './styles/App.css';

function App() {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div className="loader">Loading...</div>;
  }

  return (
    <Router>
      <div className="app">
        <Navbar user={user} onLogout={logout} />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/anime/:id" element={<Details />} />
            <Route path="/watch/:id" element={<Watch />} />
            {/* Library is the media server; Browse is AniList metadata. */}
            <Route path="/library" element={<Library />} />
            <Route path="/library/:id" element={<LibraryDetail />} />
            <Route path="/settings" element={<Settings />} />
            {user && <Route path="/profile" element={<Profile user={user} />} />}
          </Routes>
        </main>
        <footer className="footer">
          <p>&copy; 2024 Animiru. Watch anime online.</p>
        </footer>
      </div>
    </Router>
  );
}

export default App;
