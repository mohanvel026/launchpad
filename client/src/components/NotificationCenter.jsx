import { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import api from '../lib/api';

export default function NotificationCenter({ user }) {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!user) return;

    // Load initial notifications
    api.get('/notifications')
      .then(res => setNotifications(res.data.notifications || []))
      .catch(console.error);

    // Setup real-time socket connection
    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      socket.emit('join:user', user._id);
    });

    socket.on('notification', (notif) => {
      setNotifications(prev => [notif, ...prev]);
    });

    // Close dropdown on click outside
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      socket.disconnect();
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [user]);

  const handleMarkAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  const handleMarkRead = async (id, e) => {
    e.stopPropagation();
    try {
      await api.post(`/notifications/${id}/read`);
      setNotifications(prev => prev.map(n => n._id === id ? { ...n, read: true } : n));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'success': return '✅';
      case 'error': return '🔴';
      case 'warning': return '⚠️';
      default: return 'ℹ️';
    }
  };

  const timeAgo = (dateStr) => {
    const now = new Date();
    const past = new Date(dateStr);
    const diffMs = now - past;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHrs = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHrs / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 8,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          transition: 'color 0.2s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
      >
        <span style={{ fontSize: 18 }}>🔔</span>
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 8,
              height: 8,
              background: 'var(--accent-danger)',
              borderRadius: '50%',
              boxShadow: '0 0 6px var(--accent-danger)'
            }}
          />
        )}
      </button>

      {isOpen && (
        <div
          className="lp-card glass fade-in"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: 320,
            maxHeight: 400,
            overflowY: 'auto',
            zIndex: 1000,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.4)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'var(--bg-surface)'
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 13.5 }}>Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-primary)',
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: 0,
                  fontWeight: 600,
                  textDecoration: 'underline'
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>
                All caught up! No notifications.
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif._id}
                  style={{
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--border)',
                    background: notif.read ? 'transparent' : 'rgba(56, 189, 248, 0.02)',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'flex-start',
                    position: 'relative'
                  }}
                >
                  <span style={{ fontSize: 16, marginTop: 2 }}>{getIcon(notif.type)}</span>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ fontWeight: 600, fontSize: 12.5, color: notif.read ? 'var(--text-main)' : '#fff' }}>
                      {notif.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                      {notif.message}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                      {timeAgo(notif.createdAt)}
                    </div>
                  </div>
                  {!notif.read && (
                    <button
                      onClick={(e) => handleMarkRead(notif._id, e)}
                      title="Mark as read"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-dim)',
                        cursor: 'pointer',
                        padding: '4px 6px',
                        fontSize: 10,
                        alignSelf: 'center',
                        fontWeight: 600
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--text-muted)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-dim)'}
                    >
                      ✓
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
