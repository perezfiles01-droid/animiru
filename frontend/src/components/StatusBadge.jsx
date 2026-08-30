import React from 'react';
import '../styles/Pages.css';

/**
 * Whether a title is still running.
 *
 * Mangayomi's codes, which the sources return directly: 0 ongoing,
 * 1 completed, 2 hiatus, 3 canceled, 4 publishing finished, 5 unknown.
 *
 * Unknown renders nothing rather than the word "Unknown". Most scrapers
 * cannot tell, so labelling every one of them would put a meaningless badge
 * on nearly every title and teach you to ignore the badge entirely.
 */
const LABELS = {
  0: { text: 'Ongoing', tone: 'ongoing' },
  1: { text: 'Completed', tone: 'completed' },
  2: { text: 'Hiatus', tone: 'paused' },
  3: { text: 'Cancelled', tone: 'paused' },
  4: { text: 'Completed', tone: 'completed' }
};

export default function StatusBadge({ status }) {
  const known = LABELS[Number(status)];
  if (!known) return null;

  return <span className={`status-badge status-${known.tone}`}>{known.text}</span>;
}
