import React from 'react';
import { Link } from 'react-router-dom';
import '../styles/Settings.css';

/**
 * The settings index.
 *
 * A menu rather than one long page: each area gets its own screen, so a
 * phone shows a short list of destinations instead of everything at once,
 * and there is somewhere obvious to put the next one.
 */

const SECTIONS = [
  {
    to: '/settings/extensions',
    icon: '🧩',
    title: 'Extension',
    summary: 'Repositories and installed sources'
  },
  {
    to: '/settings/update',
    icon: '⬆️',
    title: 'Update',
    summary: 'Version and app updates'
  }
];

export default function Settings() {
  return (
    <div className="settings-page">
      <h1>Settings</h1>

      <nav className="settings-menu">
        {SECTIONS.map((section) => (
          <Link key={section.to} to={section.to} className="settings-menu-item">
            <span className="settings-menu-icon" aria-hidden="true">{section.icon}</span>
            <span className="settings-menu-text">
              <span className="settings-menu-title">{section.title}</span>
              <span className="settings-menu-summary">{section.summary}</span>
            </span>
            <span className="settings-menu-chevron" aria-hidden="true">›</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
