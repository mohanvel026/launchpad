import { useState, useEffect } from 'react';
import api from '../lib/api';

export function useAuth() {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const token = localStorage.getItem('lp_token');
    if (!token) {
      setTimeout(() => {
        setLoading(false);
      }, 0);
      return;
    }

    api.get('/auth/me')
      .then((res) => { if (!cancelled) setUser(res.data.user); })
      .catch(() => { if (!cancelled) localStorage.removeItem('lp_token'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    // Cleanup: prevent state updates after unmount
    return () => { cancelled = true; };
  }, []);

  const logout = () => {
    localStorage.removeItem('lp_token');
    setUser(null);
    window.location.href = '/login';
  };

  return { user, loading, logout };
}