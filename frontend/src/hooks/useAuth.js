import { useState, useEffect } from 'react';
import api from '../services/api';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const token = localStorage.getItem('authToken');
        if (!token) {
          setLoading(false);
          return;
        }

        const response = await api.get('/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setUser(response.data.user);
      } catch (err) {
        localStorage.removeItem('authToken');
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (email, password) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      localStorage.setItem('authToken', response.data.token);
      setUser(response.data.user);
      return response.data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const register = async (email, password, username) => {
    try {
      const response = await api.post('/auth/register', { email, password, username });
      localStorage.setItem('authToken', response.data.token);
      setUser(response.data.user);
      return response.data;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    setUser(null);
  };

  return { user, loading, error, login, register, logout };
}
