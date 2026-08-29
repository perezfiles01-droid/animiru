import axios from 'axios';

/**
 * The client for our own backend.
 *
 * Its base URL is compiled in at build time, so an installed app cannot be
 * repointed at another server. See DEPLOYMENT.md - without REACT_APP_API_URL
 * this falls back to localhost, which on a phone is the phone, and no source
 * can run.
 *
 * There is deliberately no auth here. The server holds no accounts and no
 * per-user data, so there is no token to attach and no 401 to recover from.
 */

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  // Running a source means scraping a site, sometimes several pages of it,
  // which routinely takes longer than a normal API call.
  timeout: 45000,
  headers: {
    'Content-Type': 'application/json'
  }
});

export default api;
