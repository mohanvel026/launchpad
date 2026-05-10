import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

export default function NewProject() {
  const [repos, setRepos]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [selected, setSelected] = useState(null);
  const [branch, setBranch]     = useState('main');
  const [creating, setCreating] = useState(false);
  const [error, setError]       = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/projects/repos')
      .then((res) => setRepos(res.data.repos))
      .catch((err) => setError(err.response?.data?.message || 'Failed to load repos'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = repos.filter((r) =>
    r.fullName.toLowerCase().includes(search.toLowerCase())
  );

  const handleDeploy = async () => {
    if (!selected) return;
    setCreating(true);
    setError('');
    try {
      const res = await api.post('/projects', {
        repoFullName: selected.fullName,
        branch,
        name: selected.name,
      });
      navigate(`/projects/${res.data.project._id}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create project');
      setCreating(false);
    }
  };

  const s = { fontFamily: 'system-ui, sans-serif', maxWidth: '700px', margin: '0 auto', padding: '2rem' };

  return (
    <div style={s}>
      <button onClick={() => navigate('/dashboard')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', marginBottom: '1rem' }}>
        ← Back
      </button>
      <h1 style={{ fontSize: '22px', marginBottom: '0.5rem' }}>New Project</h1>
      <p style={{ color: '#666', fontSize: '14px', marginBottom: '1.5rem' }}>
        Pick a GitHub repo to deploy.
      </p>

      {error && (
        <div style={{ background: '#fff1f0', border: '1px solid #fca5a5', padding: '10px 14px', borderRadius: '8px', color: '#b91c1c', fontSize: '13px', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <input
        type="text"
        placeholder="Search repos…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: '100%', padding: '10px 14px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', marginBottom: '12px', boxSizing: 'border-box' }}
      />

      {loading ? (
        <p style={{ color: '#888' }}>Loading your repos…</p>
      ) : (
        <div style={{ border: '1px solid #eee', borderRadius: '12px', overflow: 'hidden', maxHeight: '380px', overflowY: 'auto' }}>
          {filtered.map((repo) => (
            <div
              key={repo.id}
              onClick={() => { setSelected(repo); setBranch(repo.defaultBranch || 'main'); }}
              style={{
                padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0',
                background: selected?.id === repo.id ? '#eff6ff' : '#fff',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: '500', fontSize: '14px' }}>{repo.fullName}</div>
                <div style={{ fontSize: '12px', color: '#888' }}>{repo.language || 'Unknown'} · {repo.private ? 'Private' : 'Public'}</div>
              </div>
              {selected?.id === repo.id && (
                <span style={{ background: '#0070f3', color: '#fff', fontSize: '11px', padding: '2px 10px', borderRadius: '100px' }}>Selected</span>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#888', fontSize: '14px' }}>No repos found</div>
          )}
        </div>
      )}

      {selected && (
        <div style={{ marginTop: '1.5rem', padding: '1rem 1.2rem', border: '1px solid #e0eaff', borderRadius: '12px', background: '#f8faff' }}>
          <div style={{ fontSize: '13px', color: '#666', marginBottom: '8px' }}>Branch to deploy</div>
          <input
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', width: '200px' }}
          />
          <button
            onClick={handleDeploy}
            disabled={creating}
            style={{ display: 'block', marginTop: '1rem', padding: '10px 24px', background: creating ? '#aaa' : '#0070f3', color: '#fff', border: 'none', borderRadius: '8px', cursor: creating ? 'not-allowed' : 'pointer', fontSize: '14px', fontWeight: '500' }}
          >
            {creating ? 'Creating…' : `Deploy ${selected.name}`}
          </button>
        </div>
      )}
    </div>
  );
}