import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

export default function CommandPalette({ isOpen, onClose, currentProjectId, currentProjectDeployments = [] }) {
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const modalRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Load projects for searching when command palette opens
    if (isOpen) {
      setTimeout(() => {
        setQuery('');
        setFocusedIndex(0);
      }, 0);
      api.get('/projects')
        .then(res => setProjects(res.data.projects || []))
        .catch(console.error);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // static navigation commands
  const navigationCommands = [
    { title: '🏠 Go to Dashboard', url: '/dashboard' },
    { title: '🚀 Create New Project', url: '/projects/new' },
    { title: '⚙️ Account Settings', url: '/settings' }
  ];

  // project search results
  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(query.toLowerCase()) || 
    p.repoFullName?.toLowerCase().includes(query.toLowerCase())
  ).map(p => ({
    title: `📦 Open Project: ${p.name} (${p.status || 'idle'})`,
    url: `/projects/${p._id}`
  }));

  // local deployments search results (if in project detail)
  const filteredDeployments = currentProjectId ? currentProjectDeployments.filter(d => 
    (d.commitMessage || '').toLowerCase().includes(query.toLowerCase()) ||
    (d.branch || '').toLowerCase().includes(query.toLowerCase()) ||
    (d.commitSha || '').toLowerCase().includes(query.toLowerCase())
  ).map(d => ({
    title: `📜 View logs: ${d.commitMessage || 'Manual Deploy'} (${d.status})`,
    action: () => {
      // Navigate to project detail page with active tab logs and viewLogs(d)
      navigate(`/projects/${currentProjectId}?tab=logs&dep=${d._id}`);
      onClose();
    }
  })) : [];

  const allResults = [
    ...navigationCommands.filter(c => c.title.toLowerCase().includes(query.toLowerCase())),
    ...filteredProjects,
    ...filteredDeployments
  ];

  const handleSelect = (item) => {
    if (item.action) {
      item.action();
    } else if (item.url) {
      navigate(item.url);
      onClose();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(prev => (prev + 1) % allResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(prev => (prev - 1 + allResults.length) % allResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allResults[focusedIndex]) {
        handleSelect(allResults[focusedIndex]);
      }
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(2, 6, 23, 0.7)',
        backdropFilter: 'blur(8px)',
        zIndex: 2000,
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '10vh',
      }}
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className="lp-card glass fade-in"
        style={{
          width: '100%',
          maxWidth: 600,
          height: 'fit-content',
          maxHeight: '60vh',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          padding: 0
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 18, color: 'var(--text-muted)', marginRight: 12 }}>🔍</span>
          <input
            type="text"
            autoFocus
            placeholder="Type a command or search projects..."
            value={query}
            onChange={e => { setQuery(e.target.value); setFocusedIndex(0); }}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              color: 'var(--text-main)',
              fontSize: 15,
              outline: 'none',
              fontFamily: 'var(--font-sans)'
            }}
          />
          <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', padding: '3px 6px', borderRadius: 4, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            ESC
          </span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {allResults.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13.5 }}>
              No results matching "{query}"
            </div>
          ) : (
            allResults.map((item, idx) => {
              const isFocused = idx === focusedIndex;
              return (
                <div
                  key={idx}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setFocusedIndex(idx)}
                  style={{
                    padding: '12px 20px',
                    cursor: 'pointer',
                    background: isFocused ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                    color: isFocused ? 'var(--accent-primary)' : 'var(--text-main)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 13.5,
                    transition: 'all 0.1s ease-in-out',
                    borderLeft: `3px solid ${isFocused ? 'var(--accent-primary)' : 'transparent'}`
                  }}
                >
                  <span>{item.title}</span>
                  {isFocused && (
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                      ENTER ↵
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
