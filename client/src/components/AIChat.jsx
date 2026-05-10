import { useState, useRef, useEffect } from 'react';
import api from '../lib/api';

export default function AIChat({ projectId }) {
  const [messages, setMessages] = useState([
    {
      role:    'assistant',
      content: "Hi! I'm your deployment assistant. Ask me anything about your app — errors, env vars, custom domains, or how to optimize your deployment.",
    },
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.post(`/ai/${projectId}/chat`, {
        message: text,
        history: messages.slice(-6),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role:    'assistant',
        content: 'Sorry, AI assistant is unavailable right now. Check your ANTHROPIC_API_KEY in .env',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const quickQuestions = [
    'Why did my last deployment fail?',
    'How do I add a MongoDB connection?',
    'How do I set up a custom domain?',
    'Why is my app slow?',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '500px', fontFamily: 'system-ui, sans-serif' }}>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              background: msg.role === 'user' ? '#0070f3' : '#f1f5f9',
              color: msg.role === 'user' ? '#fff' : '#1e293b',
              fontSize: '13px',
              lineHeight: '1.6',
            }}>
              {msg.role === 'assistant' && (
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px', fontWeight: '500' }}>
                  🤖 AI Assistant
                </div>
              )}
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ padding: '10px 14px', borderRadius: '12px 12px 12px 2px', background: '#f1f5f9', fontSize: '13px', color: '#64748b' }}>
              🤖 Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick questions */}
      {messages.length === 1 && (
        <div style={{ padding: '0 1rem', display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
          {quickQuestions.map((q) => (
            <button key={q} onClick={() => { setInput(q); }}
              style={{ fontSize: '12px', padding: '5px 12px', border: '1px solid #e2e8f0', borderRadius: '100px', cursor: 'pointer', background: '#fff', color: '#374151' }}>
              {q}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '1rem', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '8px' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
          placeholder="Ask about your deployment…"
          style={{ flex: 1, padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '13px', outline: 'none' }}
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()}
          style={{ padding: '10px 18px', background: loading || !input.trim() ? '#aaa' : '#0070f3', color: '#fff', border: 'none', borderRadius: '10px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '500' }}>
          Send
        </button>
      </div>
    </div>
  );
}