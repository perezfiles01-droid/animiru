import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import StatusBadge from '../StatusBadge';

describe('the ongoing / completed badge', () => {
  it('says a running show is ongoing', () => {
    render(<StatusBadge status={0} />);
    expect(screen.getByText('Ongoing')).toBeInTheDocument();
  });

  it('says a finished show is completed', () => {
    render(<StatusBadge status={1} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  // Mangayomi has two codes meaning finished.
  it('treats publishing-finished as completed too', () => {
    render(<StatusBadge status={4} />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('distinguishes hiatus from cancelled', () => {
    const { rerender } = render(<StatusBadge status={2} />);
    expect(screen.getByText('Hiatus')).toBeInTheDocument();

    rerender(<StatusBadge status={3} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  // Most scrapers cannot tell. A badge on nearly every title saying
  // "Unknown" teaches the reader to ignore the badge.
  it('shows nothing at all when the status is unknown', () => {
    const { container } = render(<StatusBadge status={5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing when the source returned no status', () => {
    const { container } = render(<StatusBadge status={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
