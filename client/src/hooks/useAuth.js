import { useState, useEffect } from 'react';
import api from '../lib/api';

export function useAuth() {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('lp_token');
    if (!token) { setLoading(false); return; }

    api.get('/auth/me')
      .then((res) => setUser(res.data.user))
      .catch(() => localStorage.removeItem('lp_token'))
      .finally(() => setLoading(false));
  }, []);

  const logout = () => {
    localStorage.removeItem('lp_token');
    setUser(null);
    window.location.href = '/login';
  };

  return { user, loading, logout };
}