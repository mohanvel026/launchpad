import { useState, useRef, useEffect } from 'react';
import api from '../lib/api';

function formatMessageContent(content) {
  if (typeof content !== 'string') return content;

  // Split by code blocks first
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, index) => {
    // Code block detection
    if (part.startsWith('```')) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/);
      const language = match ? match[1] : '';
      const code = match ? match[2].trim() : part.slice(3, -3).trim();

      return (
        <div key={index} style={{
          background: '#09090e',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          margin: '12px 0',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '13px',
          overflow: 'hidden',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
        }}>
          {language && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              padding: '6px 12px',
              fontSize: '11px',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 700
            }}>
              {language}
            </div>
          )}
          <pre style={{ margin: 0, padding: '12px', overflowX: 'auto', color: '#e2e8f0', lineHeight: 1.5 }}>
            <code>{code}</code>
          </pre>
        </div>
      );
    }

    // Process paragraphs, bold highlighting, and inline code badges
    const lines = part.split('\n');
    return lines.map((line, lineIndex) => {
      const tokens = line.split(/(\*\*.*?\*\*|`.*?`)/g);

      const parsedLine = tokens.map((token, tokenIndex) => {
        if (token.startsWith('**') && token.endsWith('**')) {
          return <strong key={tokenIndex} style={{ color: 'var(--text-main)', fontWeight: 700 }}>{token.slice(2, -2)}</strong>;
        }
        if (token.startsWith('`') && token.endsWith('`')) {
          return (
            <code key={tokenIndex} style={{
              fontFamily: 'var(--font-mono, monospace)',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#38bdf8',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '12.5px',
              border: '1px solid rgba(255, 255, 255, 0.04)'
            }}>
              {token.slice(1, -1)}
            </code>
          );
        }
        return token;
      });

      return (
        <div key={`${index}-${lineIndex}`} style={{ minHeight: '1.2em', marginBottom: lineIndex < lines.length - 1 ? '8px' : 0 }}>
          {parsedLine}
        </div>
      );
    });
  });
}

export default function AIChat({ projectId }) {
  const [messages, setMessages] = useState([
    {
      role:    'assistant',
      content: "Deep-scanning production instance... System nominal. How can I assist with your deployment architecture today?",
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
        content: 'Neural link temporarily unstable. Please verify your system configuration or try again in a moment.',
      }]);
    } finally {
      setLoading(false);
    }
  };
 
  const handleQuickQuestion = async (q) => {
    if (loading) return;
    const userMsg = { role: 'user', content: q };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    try {
      const res = await api.post(`/ai/${projectId}/chat`, {
        message: q,
        history: messages.slice(-6),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role:    'assistant',
        content: 'Neural link temporarily unstable. Please verify your system configuration or try again in a moment.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const quickQuestions = [
    'Analyze last build failure',
    'Optimize for MongoDB',
    'Setup custom domain',
    'Performance audit',
  ];

  return (
    <div className="lp-card glass" style={{ display: 'flex', flexDirection: 'column', height: '600px', padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.02)' }}>
        <div className="animate-pulse-cyan" style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-primary)' }}></div>
        <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '0.05em' }}>AI CO-PILOT</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div className={msg.role === 'user' ? 'glass' : ''} style={{
              maxWidth: '85%',
              padding: '12px 18px',
              borderRadius: 16,
              background: msg.role === 'user' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.03)',
              color: msg.role === 'user' ? '#fff' : 'var(--text-main)',
              fontSize: '14px',
              lineHeight: '1.6',
              boxShadow: msg.role === 'user' ? '0 8px 24px rgba(56, 189, 248, 0.2)' : 'none',
              border: msg.role === 'user' ? 'none' : '1px solid var(--border)'
            }}>
              {formatMessageContent(msg.content)}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div className="glass" style={{ padding: '12px 18px', borderRadius: 16, fontSize: '14px', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
              <div className="loading-spinner" style={{ width: 12, height: 12, display: 'inline-block', marginRight: 8 }}></div> Thinking...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: '0 24px', display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
        {quickQuestions.map((q) => (
          <button key={q} onClick={() => handleQuickQuestion(q)} className="lp-btn-secondary" style={{ fontSize: '12px', padding: '6px 14px', borderRadius: 100 }}>
            {q}
          </button>
        ))}
      </div>

      <div style={{ padding: '24px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid var(--border)' }}>
        <div style={{ position: 'relative' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Query the AI co-pilot..."
            className="lp-search"
            style={{ width: '100%', maxWidth: 'none', paddingRight: 100, backgroundImage: 'none', paddingLeft: 20, height: 50 }}
          />
          <button 
            onClick={sendMessage} 
            disabled={loading || !input.trim()}
            className="lp-btn-primary" 
            style={{ position: 'absolute', right: 6, top: 6, bottom: 6, padding: '0 20px', fontSize: 13 }}
          >
            Ask AI
          </button>
        </div>
      </div>
    </div>
  );
}