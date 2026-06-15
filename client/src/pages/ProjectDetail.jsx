import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import NotificationCenter from '../components/NotificationCenter';
import CommandPalette from '../components/CommandPalette';

// Advanced LaunchLive Sub-components
import MetricsChart from '../components/MetricsChart';
import AnalyticsDashboard from '../components/AnalyticsDashboard';
import DomainManager from '../components/DomainManager';
import TeamManager from '../components/TeamManager';
import AIChat from '../components/AIChat';

const requiresUserInput = (key) => {
  if (!key) return false;
  const u = key.toUpperCase();
  
  if (['DATABASE_URL', 'DATABASE_URI', 'MONGODB_URI', 'MONGO_URI', 'REDIS_URL', 'REDIS_HOST', 'REDIS_PORT'].includes(u)) {
    return false;
  }
  
  if (u.startsWith('GEMINI_API_KEY') || u.startsWith('GROQ_API_KEY')) {
    return false;
  }
  
  if (['VITE_API_URL', 'REACT_APP_API_URL', 'NEXT_PUBLIC_API_URL'].includes(u)) {
    return false;
  }
  
  if (u === 'JWT_SECRET' || u === 'JWT_TOKEN' || u === 'SESSION_SECRET' || u === 'COOKIE_SECRET' || 
      u === 'APP_SECRET' || u === 'ENCRYPTION_KEY' || u === 'TOKEN_SECRET' || u === 'APP_KEY' || 
      u.endsWith('_SALT')) {
    return false;
  }
  
  if (['PORT', 'NODE_ENV', 'HOST', 'HOSTNAME'].includes(u)) {
    return false;
  }
  
  return true;
};

const SIDEBAR_GROUPS = [
  {
    title: 'Development',
    items: [
      { id: 'deployments',  label: 'Deployments',  icon: '🚀' },
      { id: 'logs',         label: 'Build Logs',   icon: '📋' },
      { id: 'runtime-logs', label: 'Runtime Logs',  icon: '🖥️' },
      { id: 'previews',     label: 'PR Previews',  icon: '🔍' },
    ]
  },
  {
    title: 'AI Assistant',
    items: [
      { id: 'ai',           label: 'AI Co-Pilot',  icon: '🤖' },
      { id: 'ai-docs',      label: 'AI Docs & Flow', icon: '📝' },
      { id: 'advisor',      label: 'AI Advisor',   icon: '🧠' },
      { id: 'guide',        label: 'How It Works', icon: '📖' },
    ]
  },
  {
    title: 'Monitoring',
    items: [
      { id: 'metrics',      label: 'Live Metrics', icon: '📊' },
      { id: 'analytics',    label: 'Analytics',    icon: '📈' },
    ]
  },
  {
    title: 'Settings',
    items: [
      { id: 'env',          label: 'Environment',  icon: '🔐' },
      { id: 'domains',      label: 'Domains',      icon: '🌐' },
      { id: 'security',     label: 'Security',     icon: '🛡️' },
      { id: 'team',         label: 'Team',         icon: '👥' },
      { id: 'settings',     label: 'Settings',     icon: '⚙️' },
    ]
  }
];

const isErrorLine = (line) => {
  return (
    /❌|🛑|🤖|diagnosis|root\s+cause|quick\s+fix|detected\s+issue|suggested\s+commands|🛠️|💻|\bfix:/i.test(line) ||
    /\b(error|errors|fail|failed|failure|failures|abort|aborted|crash|crashing|exception|invalid|missing|cannot|could\s+not|unable|issue|issues|not\s+found|not\s+exist|does\s+not\s+exist|not\s+a\s+file|exit\s+code\s+[^0])\b/i.test(line) ||
    /^\s*\$/i.test(line)
  );
};

function LogLine({ line }) {
  let cls = '';
  if (isErrorLine(line)) {
    cls = 'lp-log-error';
  } else if (/⚠️|\b(warn|warning|warnings)\b/i.test(line)) {
    cls = 'lp-log-warn';
  } else if (/✅|\b(success|successful|done|built|complete|ready)\b/i.test(line)) {
    cls = 'lp-log-success';
  } else if (/📦|📝|🔍|🐳|\b(phase|cloning|pulling|building)\b/i.test(line)) {
    cls = 'lp-log-step';
  } else if (/🚀|\b(live|deployed)\b/i.test(line)) {
    cls = 'lp-log-info';
  }
  return <div className={cls}>{line}</div>;
}

const PHASES_METADATA = [
  { key: 'fetch', label: 'Clone Repository', icon: '📥' },
  { key: 'analyze', label: 'Static Analysis', icon: '🔍' },
  { key: 'prepare', label: 'Environment Prep', icon: '⚙️' },
  { key: 'compile', label: 'Build & Compile', icon: '📦' },
  { key: 'deploy', label: 'Hot-Swap Deploy', icon: '🚀' }
];

function BuildPhaseTimeline({ deployment }) {
  if (!deployment) return null;

  const phases = deployment.buildPhases || [];
  
  const getInferredPhases = () => {
    const status = deployment.status;
    return PHASES_METADATA.map((p, idx) => {
      let phaseStatus = 'pending';
      if (status === 'success') {
        phaseStatus = 'success';
      } else if (status === 'queued') {
        phaseStatus = 'pending';
      } else if (status === 'building') {
        phaseStatus = idx === 0 ? 'running' : 'pending';
      } else if (status === 'failed') {
        phaseStatus = idx === 0 ? 'failed' : 'pending';
      }
      return { phase: p.key, status: phaseStatus };
    });
  };

  const activePhases = phases.length > 0 ? phases : getInferredPhases();

  return (
    <div className="lp-card glass animate-fade-in" style={{ padding: '20px 24px', borderRadius: 16, border: '1px solid var(--border)', marginBottom: 8 }}>
      <style>{`
        @keyframes timeline-pulse {
          0% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.4); }
          70% { box-shadow: 0 0 0 8px rgba(56, 189, 248, 0); }
          100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
        }
        .timeline-pulse-active {
          animation: timeline-pulse 1.5s infinite;
        }
      `}</style>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 16 }}>
        Build Execution Pipeline
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, overflowX: 'auto', paddingBottom: 8 }}>
        {PHASES_METADATA.map((meta, idx) => {
          const phaseData = activePhases.find(p => p.phase === meta.key) || { status: 'pending' };
          const { status, duration } = phaseData;
          
          let color = 'var(--text-dim)';
          let dotBg = 'rgba(255, 255, 255, 0.02)';
          let dotBorder = '1px solid var(--border)';
          let isPulsing = false;

          if (status === 'success') {
            color = '#10b981';
            dotBg = 'rgba(16, 185, 129, 0.1)';
            dotBorder = '1px solid rgba(16, 185, 129, 0.3)';
          } else if (status === 'failed') {
            color = '#ef4444';
            dotBg = 'rgba(239, 68, 68, 0.1)';
            dotBorder = '1px solid rgba(239, 68, 68, 0.3)';
          } else if (status === 'running') {
            color = '#38bdf8';
            dotBg = 'rgba(56, 189, 248, 0.1)';
            dotBorder = '1px solid #38bdf8';
            isPulsing = true;
          }

          const formattedDuration = duration 
            ? `${(duration / 1000).toFixed(1)}s` 
            : phaseData.startedAt && phaseData.finishedAt
              ? `${((new Date(phaseData.finishedAt) - new Date(phaseData.startedAt)) / 1000).toFixed(1)}s`
              : status === 'running' && phaseData.startedAt
                ? 'building...'
                : '';

          return (
            <div key={meta.key} style={{ display: 'flex', flex: 1, alignItems: 'center', minWidth: 140, position: 'relative' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 }}>
                <div 
                  className={isPulsing ? "timeline-pulse-active" : ""}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: dotBg,
                    border: dotBorder,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 16,
                    zIndex: 1,
                    transition: 'all 0.3s ease'
                  }}
                >
                  {status === 'success' ? <span style={{ color: '#10b981', fontWeight: 'bold' }}>✓</span> : status === 'failed' ? <span style={{ color: '#ef4444', fontWeight: 'bold' }}>✗</span> : meta.icon}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: status !== 'pending' ? 'var(--text-main)' : 'var(--text-dim)', textAlign: 'center' }}>
                  {meta.label}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {formattedDuration && (
                    <span style={{ fontSize: 10, color: color, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {formattedDuration}
                    </span>
                  )}
                  {phaseData.isCached && (
                    <span style={{
                      fontSize: 8,
                      fontWeight: 800,
                      background: 'rgba(52, 211, 153, 0.12)',
                      color: '#34d399',
                      border: '1px solid rgba(52, 211, 153, 0.25)',
                      padding: '1px 4px',
                      borderRadius: 4,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em'
                    }}>
                      Cached
                    </span>
                  )}
                </div>
              </div>
              
              {idx < PHASES_METADATA.length - 1 && (
                <div style={{
                  position: 'absolute',
                  right: -8,
                  top: 18,
                  width: 'calc(100% - 36px)',
                  left: 'calc(50% + 18px)',
                  height: 2,
                  background: status === 'success' ? '#10b981' : 'var(--border)',
                  zIndex: 0,
                  opacity: status === 'success' ? 0.6 : 0.2,
                  transition: 'background 0.3s'
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      background: '#09090e',
      border: '1px solid rgba(255, 255, 255, 0.05)',
      borderRadius: '8px',
      margin: '12px 0',
      fontFamily: 'var(--font-mono, monospace)',
      fontSize: '13px',
      overflow: 'hidden',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
    }}>
      <div style={{
        background: 'rgba(255, 255, 255, 0.02)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        padding: '6px 12px',
        fontSize: '11px',
        color: 'var(--text-dim)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        fontWeight: 700,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            color: copied ? '#34d399' : 'var(--accent-primary)',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            padding: 0
          }}
        >
          {copied ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              Copy
            </>
          )}
        </button>
      </div>
      <pre style={{ margin: 0, padding: '12px', overflowX: 'auto', color: '#e2e8f0', lineHeight: 1.5 }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function formatMessageContent(content) {
  if (typeof content !== 'string') return content;
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, index) => {
    if (part.startsWith('```')) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/);
      const language = match ? match[1] : '';
      const code = match ? match[2].trim() : part.slice(3, -3).trim();

      return <CodeBlock key={index} code={code} language={language} />;
    }

    const lines = part.split('\n');
    return lines.map((partLine, lineIndex) => {
      const tokens = partLine.split(/(\*\*.*?\*\*|`.*?`)/g);
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
              fontSize: '12px',
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

const SIMULATION_SCENARIOS = {
  'app-crash': {
    name: '💥 App Crash (OOM)',
    steps: [
      '🩺 [00:00] Telemetry worker detected HTTP 502 Bad Gateway / Connection Refused.',
      '🚨 [00:02] Docker container exited with code 137 (OOMKilled).',
      '🧠 [00:03] AI Healing System initiated: Analyzing the last 50 lines of crash logs...',
      '🔍 [00:05] Diagnostic: JavaScript heap out of memory. Detected active leaks during heavy loads.',
      '🛠️ [00:06] AI Fix Applied: Generating custom Dockerfile optimized with --max-old-space-size=450 flag, scaling container memory limit.',
      '🚀 [00:08] Deploying hot-swap container container-v3-healed...',
      '🌐 [00:09] Health checks passed! Swapping Nginx reverse proxy routes. Old container terminated.',
      '✅ [00:10] System fully restored. Zero-downtime recovery completed in 10 seconds.'
    ],
    prompt: (projectName, stack) => `You are the LaunchLive SRE AI Architect.
The user just simulated a DevOps/SRE incident: "Application container crash / Out of Memory" on this project: "${projectName}" (Stack: "${stack}").
Provide a clear, detailed 3-paragraph explanation of:
1. Exactly what LaunchLive did in the simulation logs.
2. How LaunchLive prevents this problem or heals it in the real production environment for their specific stack ("${stack}").
3. Give recommendations on how the developer can configure their settings (like auto-heal, memory bounds, webhooks) to optimize this.
Use bold headers, bullet lists, and code blocks for code snippets. Keep it highly technical, SRE-expert-toned, and encouraging.`
  },
  'ssl-expired': {
    name: '🔒 SSL Expiry & Renewal',
    steps: [
      '⏰ [00:00] Let\'s Encrypt cron job scheduled run (Weekly Monday 3:00 AM).',
      `🔒 [00:02] Checking certificate validity for domain {{DOMAIN}}...`,
      '⚠️ [00:03] Alert: SSL certificate expires in 6 days. Renewing via DNS challenge.',
      '🌐 [00:05] DNS verification check passed against Cloudflare API.',
      '🔑 [00:06] Certbot requested new certificate pair from Let\'s Encrypt CA.',
      `💾 [00:08] Saving new certs to /etc/letsencrypt/live/{{DOMAIN}}/`,
      '⚙️ [00:09] Executing: nginx -s reload',
      '✅ [00:10] SSL cert successfully renewed for 90 days. Zero-downtime cert reload complete.'
    ],
    prompt: (projectName, stack) => `You are the LaunchLive SRE AI Architect.
The user just simulated a DevOps/SRE incident: "SSL certificate expiry & Certbot renew" on this project: "${projectName}" (Stack: "${stack}").
Provide a clear, detailed 3-paragraph explanation of:
1. Exactly what LaunchLive did in the simulation logs.
2. How LaunchLive prevents this problem or heals it in the real production environment.
3. Give recommendations on how the developer can configure their settings to optimize this.
Use bold headers, bullet lists, and code blocks for code snippets. Keep it highly technical, SRE-expert-toned, and encouraging.`
  },
  'build-fail': {
    name: '🛑 Build Failure & Code Healing',
    steps: [
      '🐙 [00:00] Webhook received: Push on \'main\' branch of github.com/user/project',
      '🛠️ [00:02] Starting compilation pipeline for application.',
      '❌ [00:04] Error: Build failed with exit code 1. Missing module or compilation error detected.',
      '🚨 [00:05] Build stage failed. Activating AI build repair worker...',
      '🔍 [00:07] AI analysis: Discovered missing runtime modules and syntax error in configuration.',
      '🛠️ [00:08] AI repair: Injecting package dependency and repairing configs.',
      '📦 [00:09] Retrying build with repaired files... Success!',
      '🔀 [00:10] Generating GitHub Pull Request with verification patch...',
      '✅ [00:11] Build completed successfully. App deployed to production staging.'
    ],
    prompt: (projectName, stack) => `You are the LaunchLive SRE AI Architect.
The user just simulated a DevOps/SRE incident: "Git webhook build failure & code healing" on this project: "${projectName}" (Stack: "${stack}").
Provide a clear, detailed 3-paragraph explanation of:
1. Exactly what LaunchLive did in the simulation logs.
2. How LaunchLive prevents this problem or heals it in the real production environment for their specific stack ("${stack}").
3. Give recommendations on how the developer can configure their settings (like auto-heal, memory bounds, webhooks) to optimize this.
Use bold headers, bullet lists, and code blocks for code snippets. Keep it highly technical, SRE-expert-toned, and encouraging.`
  }
};

const NODE_DESCRIPTIONS = {
  'Dev': {
    title: '💻 Developer Push',
    role: 'Source Code & Deployment Ingestion',
    why: 'Manual deployments require server access, shell scripts, and complex configuration files, leading to human errors and server outages.',
    works: 'When you push new commits to your connected GitHub branch, a Git webhook is securely fired to LaunchLive.',
    value: 'Saves developer time and removes human error from the deployment pipeline.',
    how: 'Connect your GitHub repository and select your branch under the Settings tab.'
  },
  'Webhook': {
    title: '🔗 Webhook Router',
    role: 'Automated Trigger & Payload Validation',
    why: 'Polling repositories periodically for changes creates massive network overhead and delays deployment times.',
    works: 'Validates GitHub requests using HMAC-SHA256 signature verification with your secret token, preventing spoofing, and checks for concurrent builds.',
    value: 'Ensures immediate, secure, and authenticated building of code changes.',
    how: 'Automatically configured when you connect your project. You can copy the webhook URL from the Settings tab.'
  },
  'Build': {
    title: '⚙️ Build Engine',
    role: 'Isolated Asset Compilation & Test Sandbox',
    why: 'Running build commands directly on your production server can exhaust memory and crash running web apps.',
    works: 'Runs your custom setup and compilation commands inside a sandboxed environment, capping output logs and verifying compiler success.',
    value: 'Prevents resource exhaustion on production services during deployments.',
    how: 'Define your Install, Build, and Output directory options in the Settings tab.'
  },
  'Proxy': {
    title: '🌐 Nginx Gateway & SSL Router',
    role: 'Reverse Proxy, SSL termination & Zero-Downtime Hot-Swapping',
    why: 'Configuring web servers, renewing SSL certs, and swapping server ports usually drops active websocket connections.',
    works: 'Proxies domain traffic to container ports. Integrates with Let\'s Encrypt for auto-renewal and holds traffic during hot-swaps.',
    value: 'Ensures zero-downtime container updates and fully automated HTTPS security.',
    how: 'Configure subdomains or add custom CNAME domains in the Domains tab.'
  },
  'App': {
    title: '📦 App Container',
    role: 'Dockerized Runtime Sandbox',
    why: 'Shared process environments allow buggy applications to compromise server security or crash neighboring services.',
    works: 'Spins up your application in a dedicated Docker sandbox with custom kernel namespaces and CPU/RAM limit limits.',
    value: 'Guarantees process isolation, security, and strict resource allocation.',
    how: 'Adjust CPU core bounds and RAM memory limits dynamically in the Settings tab.'
  },
  'Monitor': {
    title: '📈 Telemetry Monitor',
    role: 'Redis-backed Sliding Window performance metrics',
    why: 'Standard APM monitoring agents (like Datadog/NewRelic) are heavy, expensive, and delay warning notifications.',
    works: 'Streams request metadata and container memory metrics into a high-performance Redis database to monitor real-time health.',
    value: 'Detects memory leaks, connection drops, and HTTP 502/504 gateways instantly.',
    how: 'View live request throughput, response times, and system metrics under the Live Metrics tab.'
  },
  'AI': {
    title: '🧠 AI SRE Agent',
    role: 'Self-Healing Engine & Automated Repair',
    why: 'When production servers crash in the middle of the night, someone has to log in, read logs, write a fix, and redeploy.',
    works: 'Monitors crash reports, parses syntax errors, creates a temporary branch with targeted code fixes, validates them, and pushes patches.',
    value: 'Achieves self-healing infrastructure, resolving simple bugs autonomously without human intervention.',
    how: 'Check the Auto-Heal checkbox and select your preferred healing strategy under the Settings tab.'
  }
};

const BuildCountdownTimer = ({ startedAt, estimatedDuration }) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!startedAt) return;
    const start = new Date(startedAt).getTime();
    
    const tick = () => {
      const diff = Math.max(0, Math.floor((Date.now() - start) / 1000));
      setElapsed(diff);
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  const duration = estimatedDuration || 120; // fallback 2 mins
  const remaining = Math.max(0, duration - elapsed);
  const percent = Math.min(100, (elapsed / duration) * 100);

  const formatTime = (sec) => {
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  };

  return (
    <div className="lp-card glass fade-in" style={{
      padding: '16px 20px',
      border: '1px solid rgba(56, 189, 248, 0.2)',
      background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.6) 0%, rgba(30, 41, 59, 0.6) 100%)',
      borderRadius: 12,
      marginBottom: 16
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 6 }}>
          ⚡ Live Build Estimation
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: remaining > 0 ? 'var(--accent-primary)' : '#10b981' }}>
          {remaining > 0 ? `Estimated remaining: ${formatTime(remaining)}` : 'Build finishing up...'}
        </span>
      </div>
      <div style={{ width: '100%', height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
        <div style={{
          width: `${percent}%`,
          height: '100%',
          background: 'linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
          transition: 'width 1s linear',
          boxShadow: '0 0 8px rgba(56, 189, 248, 0.4)'
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
        <span>Elapsed: {formatTime(elapsed)}</span>
        <span>Total Est: {formatTime(duration)}</span>
      </div>
    </div>
  );
};

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [project,     setProject]     = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [logs,        setLogs]        = useState([]);
  const [runtimeLogs, setRuntimeLogs] = useState([]);
  const [deploying,   setDeploying]   = useState(false);
  const [activeTab,   setActiveTab]   = useState('deployments');
  const [cpuUsage,    setCpuUsage]    = useState(null);
  const [ramUsage,    setRamUsage]    = useState(null);
  const [showDeployDropdown, setShowDeployDropdown] = useState(false);
  const [error,       setError]       = useState('');
  const [saveStatus,  setSaveStatus]  = useState('');

  // Env vars
  const [envVars,  setEnvVars]  = useState([]);
  const [envChanged, setEnvChanged] = useState(false);
  const [envKey,   setEnvKey]   = useState('');
  const [envValue, setEnvValue] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [bulkEnv,  setBulkEnv]  = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [showVal,  setShowVal]  = useState({});
  const [decryptedVals, setDecryptedVals] = useState({});
  const [aiScanning, setAiScanning] = useState(false);
  const [envHistory, setEnvHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Settings
  const [settings, setSettings] = useState({ installCommand: '', buildCommand: '', outputDir: '', branch: '', autoHeal: false, autoHealStrategy: 'push-on-success', healthCheckPath: '', persistentPath: '' });
  const [activeDeployment, setActiveDeployment] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [quickEnvValue, setQuickEnvValue] = useState('');
  const [quickEnvLoading, setQuickEnvLoading] = useState(false);
  const [editingNotesDepId, setEditingNotesDepId] = useState(null);
  const [tempNotes, setTempNotes] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  const [envScopes, setEnvScopes] = useState(['production', 'preview', 'development']);
  const [deployHooks, setDeployHooks] = useState([]);
  const [newHookName, setNewHookName] = useState('');
  const [newHookBranch, setNewHookBranch] = useState('main');
  const [outgoingWebhooks, setOutgoingWebhooks] = useState([]);
  const [newHookUrl, setNewHookUrl] = useState('');
  const [newHookType, setNewHookType] = useState('slack');
  const [newHookEvents, setNewHookEvents] = useState(['start', 'success', 'failure']);
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);

  // Dockerfile Editor States
  const [dockerfile, setDockerfile] = useState('');
  const [dockerfileLoading, setDockerfileLoading] = useState(false);
  const [lintResults, setLintResults] = useState(null);
  const [linting, setLinting] = useState(false);
  const [savingDockerfile, setSavingDockerfile] = useState(false);
  const [dockerfileMessage, setDockerfileMessage] = useState('');

  // Multi-Region & Cron Scheduled Deployment States
  const [regions, setRegions] = useState(['us-ashburn-1']);
  const [cronSchedule, setCronSchedule] = useState('');
  const [cronEnabled, setCronEnabled] = useState(false);

  // Persistent Volume States
  const [volumeDetails, setVolumeDetails] = useState({ exists: false, totalSize: 0, files: [] });
  const [volumeLoading, setVolumeLoading] = useState(false);
  const [volumeActionLoading, setVolumeActionLoading] = useState(false);
  const [volumeError, setVolumeError] = useState(null);
  const [badgeTimestamp] = useState(() => Date.now());
  const [regionsSaving, setRegionsSaving] = useState(false);
  const [cronSaving, setCronSaving] = useState(false);
  const [regionsMessage, setRegionsMessage] = useState('');
  const [cronMessage, setCronMessage] = useState('');

  // AI Docs & Flows States
  const [aiDocsData, setAiDocsData] = useState(null);
  const [aiDocsLoading, setAiDocsLoading] = useState(false);
  const [aiDocsSubTab, setAiDocsSubTab] = useState('readme');
  const [aiDocsError, setAiDocsError] = useState('');
  const [commitStatus, setCommitStatus] = useState('');
  const [commitMessage, setCommitMessage] = useState('');

  const filteredLogsWithIndex = logs
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => {
      const matchesSearch = logSearchQuery ? line.toLowerCase().includes(logSearchQuery.toLowerCase()) : true;
      const matchesError = showErrorsOnly ? isErrorLine(line) : true;
      return matchesSearch && matchesError;
    });

  const jumpToFirstError = () => {
    const firstErrorIdx = logs.findIndex(line => isErrorLine(line));
    if (firstErrorIdx !== -1) {
      setShowErrorsOnly(false);
      setLogSearchQuery('');
      setTimeout(() => {
        const el = document.getElementById(`log-line-${firstErrorIdx}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
          el.style.transition = 'background-color 0.5s ease';
          setTimeout(() => {
            el.style.backgroundColor = '';
          }, 2000);
        }
      }, 100);
    }
  };

  // SRE Container Limits
  const [cpuLimit, setCpuLimit] = useState(0.5);
  const [ramLimitMB, setRamLimitMB] = useState(256);
  const [resizing, setResizing] = useState(false);

  // Container controls
  const [containerAction, setContainerAction] = useState(null); // 'stopping'|'starting'|'restarting'|'cancelling'

  // 🛡️ Security / Vulnerability Scanner
  const [vulnData, setVulnData] = useState(null);
  const [vulnLoading, setVulnLoading] = useState(false);
  const [vulnFixData, setVulnFixData] = useState(null);
  const [vulnFixLoading, setVulnFixLoading] = useState(false);
  const [applyingVulnFix, setApplyingVulnFix] = useState(false);

  // 🧠 AI Deployment Advisor (Readiness)
  const [readiness, setReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(false);

  // 📊 Build Performance Trends
  const [buildTrends, setBuildTrends] = useState(null);
  const [trendsLoading, setTrendsLoading] = useState(false);

  // 💰 Cost Estimator
  const [costData, setCostData] = useState(null);
  const [costLoading, setCostLoading] = useState(false);

  // 🫀 Runtime Health Monitor
  const [healthData, setHealthData] = useState(null); // eslint-disable-line no-unused-vars
  const [healthLoading, setHealthLoading] = useState(false); // eslint-disable-line no-unused-vars

  // ⏮️ Rollback
  const [rollingBack, setRollingBack] = useState(null); // deploymentId being rolled back

  // 🔍 PR Preview Environments
  const [previews, setPreviews] = useState([]);
  const [previewsLoading, setPreviewsLoading] = useState(false);
  const [newPreviewPR, setNewPreviewPR] = useState('');
  const [newPreviewBranch, setNewPreviewBranch] = useState('');
  const [creatingPreview, setCreatingPreview] = useState(false);
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false); // eslint-disable-line no-unused-vars
  const [customQuestion, setCustomQuestion] = useState('');
  const [architectMessages, setArchitectMessages] = useState([]);
  const [architectLoading, setArchitectLoading] = useState(false);
  const [guideSubTab, setGuideSubTab] = useState('systems');
  const [activeSimulation, setActiveSimulation] = useState(null);
  const [simulationSteps, setSimulationSteps] = useState([]);
  const [simulationResponse, setSimulationResponse] = useState('');
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [archDiagram, setArchDiagram] = useState('');
  const [archDiagramLoading, setArchDiagramLoading] = useState(false);
  const [deepDiveSystem, setDeepDiveSystem] = useState(null);
  const [deepDiveResponse, setDeepDiveResponse] = useState('');
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);

  const [selectedNode, setSelectedNode] = useState(null);
  const [stepMode, setStepMode] = useState('auto');
  const [currentStep, setCurrentStep] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [simulationSpeed, setSimulationSpeed] = useState(1);
  const [showSandboxGuide, setShowSandboxGuide] = useState(true);
  
  const isPausedRef = useRef(isPaused);
  const speedRef = useRef(simulationSpeed);
  const activeSimulationRef = useRef(activeSimulation);


  // 🔐 Env Vault — AI missing variable scanner
  const [missingVars, setMissingVars] = useState(null); // null = not scanned, [] = none found
  const [missingVarsLoading, setMissingVarsLoading] = useState(false);
  const [addingMissingVar, setAddingMissingVar] = useState(null); // key being added
  const [envWarnings, setEnvWarnings] = useState([]);
  const [envCollisions, setEnvCollisions] = useState([]);

  const logsEndRef = useRef(null);
  const runtimeLogsEndRef = useRef(null);
  const socketRef  = useRef(null);
  const connectingRef = useRef(null);
  const pollRef    = useRef(null);
  const chatEndRef = useRef(null);

  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const deploymentsRef = useRef(deployments);
  useEffect(() => {
    deploymentsRef.current = deployments;
  }, [deployments]);

  const fetchBranches = useCallback(async (repoFullName) => {
    if (!repoFullName) return;
    setLoadingBranches(true);
    try {
      const res = await api.post('/projects/repos/analyze', { repoFullName });
      if (res.data && res.data.branches) {
        setBranches(res.data.branches);
      }
    } catch (err) {
      console.warn('Failed to load repo branches:', err.message);
    } finally {
      setLoadingBranches(false);
    }
  }, []);

  const handleAskArchitect = async (questionText) => {
    if (!questionText.trim() || architectLoading) return;
    setArchitectLoading(true);
    const userMsg = { role: 'user', content: questionText };
    const updatedMessages = [...architectMessages, userMsg];
    setArchitectMessages(updatedMessages);
    setCustomQuestion('');
    try {
      const SreSystemPrompt = `You are the LaunchLive SRE AI Architect.
The developer is asking a question about how LaunchLive behaves, manages resources, or automates this specific project.
Please provide a detailed, technical explanation of how LaunchLive operates, focusing on our Docker container orchestration, Nginx reverse proxy routing, Let's Encrypt SSL provision/renew crons, OSV vulnerability scanning, scale-to-zero sleeping timeouts, and AI auto-healing systems. Keep the response developer-focused, encouraging, and clear.
Use bold headers, lists, code blocks, or tables to format your response.`;

      const apiHistory = updatedMessages.slice(-6).map(m => ({
        role: m.role,
        content: m.content
      }));

      const res = await api.post(`/ai/${id}/chat`, {
        message: `${SreSystemPrompt}\nQuestion: "${questionText}"`,
        history: apiHistory.slice(0, -1)
      });
      const answer = res.data.reply || res.data.response || res.data.message || 'No response returned from the SRE AI Architect.';
      setArchitectMessages(prev => [...prev, { role: 'assistant', content: answer }]);
    } catch (err) {
      const errMsg = err.response?.data?.message || 'Failed to connect to the AI SRE Architect.';
      setArchitectMessages(prev => [...prev, { role: 'assistant', content: `❌ **Error:** ${errMsg}` }]);
    } finally {
      setArchitectLoading(false);
    }
  };

  const handleRunSimulation = async (scenarioKey, mode = 'auto') => {
    if (simulationLoading && mode === 'auto') return;

    try {
      setActiveSimulation(scenarioKey);
      activeSimulationRef.current = scenarioKey; // Sync Ref to prevent race condition
      setStepMode(mode);
      setSimulationResponse('');
      setSimulationSteps([]);
      setCurrentStep(0);
      setIsPaused(false);
      isPausedRef.current = false; // Sync Ref synchronously to bypass React scheduling delay
      setSimulationLoading(true);

      const domain = project?.subdomain ? `${project.subdomain}.launchlive.in` : 'app.launchlive.in';
      const scenario = SIMULATION_SCENARIOS[scenarioKey];
      if (!scenario) {
        throw new Error(`Simulation scenario "${scenarioKey}" not found`);
      }

      const rawSteps = scenario.steps || [];
      const steps = rawSteps.map(s => typeof s === 'string' ? s.replace(/\{\{DOMAIN\}\}/g, domain) : String(s));

      if (mode === 'auto') {
        for (let i = 0; i < steps.length; i++) {
          while (isPausedRef.current) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (activeSimulationRef.current !== scenarioKey) {
              setSimulationLoading(false);
              return;
            }
          }

          if (activeSimulationRef.current !== scenarioKey) {
            setSimulationLoading(false);
            return;
          }

          setCurrentStep(i);
          setSimulationSteps(steps.slice(0, i + 1));
          
          const currentSpeed = speedRef.current || 1;
          const delay = 850 / currentSpeed;
          await new Promise(resolve => setTimeout(resolve, delay));
          
          if (activeSimulationRef.current !== scenarioKey) {
            setSimulationLoading(false);
            return;
          }
        }
        
        while (isPausedRef.current) {
          await new Promise(resolve => setTimeout(resolve, 100));
          if (activeSimulationRef.current !== scenarioKey) {
            setSimulationLoading(false);
            return;
          }
        }
        
        await finishSimulation(scenarioKey);
      } else {
        setCurrentStep(0);
        setSimulationSteps([steps[0]]);
        setSimulationLoading(false);
      }
    } catch (err) {
      console.error('[Simulator SRE Error]:', err);
      setSimulationSteps([`❌ Simulation initialization failed: ${err.message}`]);
      setSimulationLoading(false);
    }
  };

  const handleResetSimulation = () => {
    setActiveSimulation(null);
    activeSimulationRef.current = null; // Sync Ref to cancel loop immediately
    setSimulationSteps([]);
    setSimulationResponse('');
    setSimulationLoading(false);
    setIsPaused(false);
    isPausedRef.current = false; // Sync Ref synchronously
    setCurrentStep(0);
  };

  const handleNextSimulationStep = async () => {
    if (!activeSimulation || simulationLoading) return;
    const domain = project?.subdomain ? `${project.subdomain}.launchlive.in` : 'app.launchlive.in';
    const rawSteps = SIMULATION_SCENARIOS[activeSimulation].steps;
    const steps = rawSteps.map(s => s.replace(/\{\{DOMAIN\}\}/g, domain));
    const nextIndex = currentStep + 1;

    if (nextIndex < steps.length) {
      setCurrentStep(nextIndex);
      setSimulationSteps(steps.slice(0, nextIndex + 1));
      if (nextIndex === steps.length - 1) {
        setSimulationLoading(true);
        await finishSimulation(activeSimulation);
      }
    }
  };

  const finishSimulation = async (scenarioKey) => {
    try {
      const promptGen = SIMULATION_SCENARIOS[scenarioKey].prompt;
      const prompt = promptGen(project?.name || 'this project', project?.stack || 'current');
      const res = await api.post(`/ai/${id}/chat`, { message: prompt });
      const reply = res.data.reply || res.data.response || res.data.message || 'Simulation completed successfully.';
      setSimulationResponse(reply);
    } catch (err) {
      setSimulationResponse(`❌ **Simulation Error:** ${err.response?.data?.message || err.message}`);
    } finally {
      setSimulationLoading(false);
    }
  };

  const handleAskAboutNode = (nodeName) => {
    const desc = NODE_DESCRIPTIONS[nodeName];
    if (!desc) return;
    setGuideSubTab('chat');
    handleAskArchitect(`Explain the role, internal mechanics, and configuration of the "${desc.title}" component in the context of my project.`);
  };

  const handleClearChat = () => {
    if (project) {
      setArchitectMessages([
        {
          role: 'assistant',
          content: `🤖 Greetings! I am the SRE AI Architect for **${project.name}**. I oversee the container scaling, Nginx reverse proxies, SSL certificate crons, and the telemetry auto-healing monitor for this application.\n\nAsk me anything about how the infrastructure runs, click on a quick suggestion, or run a **DevOps Simulation** below!`
        }
      ]);
    }
  };

  const getSimulatedMetrics = (scenarioKey, step) => {
    if (scenarioKey === 'app-crash') {
      const metrics = [
        { cpu: 25, ram: 180, status: 'Memory leak alert', code: 200, ssl: 90 },
        { cpu: 98, ram: 512, status: 'OOM Threshold Reached', code: 500, ssl: 90 },
        { cpu: 0, ram: 0, status: 'Container Dead', code: 502, ssl: 90 },
        { cpu: 0, ram: 0, status: 'AI Diagnosing Logs', code: 502, ssl: 90 },
        { cpu: 15, ram: 45, status: 'Testing Sandbox Patch', code: 502, ssl: 90 },
        { cpu: 45, ram: 140, status: 'Traffic Routing Swapped', code: 200, ssl: 90 },
        { cpu: 12, ram: 110, status: 'Operational & Stable', code: 200, ssl: 90 },
      ];
      return metrics[step] || { cpu: 12, ram: 110, status: 'Operational & Stable', code: 200, ssl: 90 };
    }
    if (scenarioKey === 'build-fail') {
      const metrics = [
        { cpu: 5, ram: 80, status: 'Webhook received', code: 200, ssl: 90 },
        { cpu: 85, ram: 210, status: 'Dependencies installing', code: 200, ssl: 90 },
        { cpu: 5, ram: 80, status: 'Syntax error detected', code: 200, ssl: 90 },
        { cpu: 15, ram: 80, status: 'AI Scanning compiler log', code: 200, ssl: 90 },
        { cpu: 20, ram: 80, status: 'AI Patching source files', code: 200, ssl: 90 },
        { cpu: 90, ram: 230, status: 'Recompiling patched app', code: 200, ssl: 90 },
        { cpu: 35, ram: 130, status: 'Traffic routing swapped', code: 200, ssl: 90 },
        { cpu: 10, ram: 95, status: 'Operational & Stable', code: 200, ssl: 90 },
      ];
      return metrics[step] || { cpu: 10, ram: 95, status: 'Operational & Stable', code: 200, ssl: 90 };
    }
    if (scenarioKey === 'ssl-expired') {
      const metrics = [
        { cpu: 12, ram: 95, status: 'Verifying TLS cert', code: 200, ssl: 90 },
        { cpu: 12, ram: 95, status: 'TLS certificate expired', code: 495, ssl: 0 },
        { cpu: 12, ram: 95, status: 'AI alerted on expiry', code: 495, ssl: 0 },
        { cpu: 30, ram: 110, status: 'Verifying DNS TXT challenge', code: 495, ssl: 0 },
        { cpu: 35, ram: 110, status: 'Let\'s Encrypt validation', code: 495, ssl: 0 },
        { cpu: 20, ram: 110, status: 'SSL certificate issued', code: 495, ssl: 90 },
        { cpu: 28, ram: 115, status: 'Hot-reloading Nginx gateway', code: 200, ssl: 90 },
        { cpu: 10, ram: 95, status: 'TLS Secure & Healthy', code: 200, ssl: 90 },
      ];
      return metrics[step] || { cpu: 10, ram: 95, status: 'TLS Secure & Healthy', code: 200, ssl: 90 };
    }
    return { cpu: 0, ram: 0, status: 'Inactive', code: null, ssl: 90 };
  };

  const handleGenerateArchitecture = async () => {
    if (archDiagramLoading) return;
    setArchDiagramLoading(true);
    setArchDiagram('');
    try {
      const prompt = `You are the LaunchLive SRE AI Architect.
Generate a custom, production-ready system architecture map for this project: "${project.name}" (Stack: "${project.stack}", Domain: "${project?.subdomain ? `${project.subdomain}.launchlive.in` : 'no domain'}").
Please construct a visual diagram using text-based styling (ASCII art, boxes, or block symbols like ┌─┐, ├─┤, ▼, ➔, ──) showing:
1. Public client HTTPS request path.
2. Cloudflare Edge DNS & Nginx Reverse Proxy routing to internal Docker ports (e.g. port ${project?.port || 'dynamic'}).
3. Docker container sandboxing with custom limits (CPU: ${project?.cpuLimit || 0.5} OCPU, RAM: ${project?.ramLimitMB || 256} MB).
4. Redis / MongoDB database link if any.
5. Ingress log pipeline flowing to Redis real-time telemetry.

Under the diagram, provide a detailed bulleted key explaining each component. Make it look professional, clean, and impressive.`;

      const res = await api.post(`/ai/${id}/chat`, { message: prompt });
      const reply = res.data.reply || res.data.response || res.data.message || 'No diagram returned.';
      setArchDiagram(reply);
    } catch (err) {
      setArchDiagram(`❌ **Failed to generate architecture diagram:** ${err.response?.data?.message || err.message}`);
    } finally {
      setArchDiagramLoading(false);
    }
  };

  const handleDeepDive = async (systemTitle, systemDesc) => {
    setDeepDiveSystem({ title: systemTitle, desc: systemDesc });
    setDeepDiveLoading(true);
    setDeepDiveResponse('');
    try {
      const prompt = `You are the LaunchLive SRE AI Architect.
The user wants an in-depth, stack-specific technical explanation of the following platform automation feature:
Feature: "${systemTitle}"
General description: "${systemDesc}"

Project Context:
- Project: "${project.name}"
- Stack/Framework: "${project.stack}"
- Subdomain: "${project?.subdomain || 'app'}.launchlive.in"
- Settings: CPU Limit ${project?.cpuLimit || 0.5} OCPU, RAM ${project?.ramLimitMB || 256}MB, Auto-Heal: ${project?.autoHeal ? 'Enabled' : 'Disabled'}.

Please provide a detailed, technical explanation of how this feature applies directly to their "${project.stack}" application.
Include:
1. Specific Nginx or Dockerfile configs we generate for their stack.
2. The exact commands or API workflows executed during this process.
3. Best practices for maintaining zero-downtime and high security for "${project.stack}".
Use bold headers, bullet lists, and code blocks.`;

      const res = await api.post(`/ai/${id}/chat`, { message: prompt });
      const reply = res.data.reply || res.data.response || res.data.message || 'No deep-dive data returned.';
      setDeepDiveResponse(reply);
    } catch (err) {
      setDeepDiveResponse(`❌ **Failed to load deep-dive:** ${err.response?.data?.message || err.message}`);
    } finally {
      setDeepDiveLoading(false);
    }
  };

  const loadProject = useCallback(async () => {
    try {
      const r = await api.get(`/projects/${id}`);
      const p = r.data.project;
      setProject(p);
      fetchBranches(p.repoFullName);
      setCpuLimit(p.cpuLimit || 0.5);
      setRamLimitMB(p.ramLimitMB || 256);
      setSettings({
        installCommand: p.installCommand || '',
        buildCommand:   p.buildCommand   || '',
        outputDir:      p.outputDir      || '',
        branch:         p.branch         || 'main',
        autoHeal:       !!p.autoHeal,
        autoHealStrategy: p.autoHealStrategy || 'push-on-success',
        healthCheckPath: p.healthCheckPath || '',
        persistentPath: p.persistentPath || '',
      });
      setRegions(p.regions || ['us-ashburn-1']);
      setCronSchedule(p.cronSchedule || '');
      setCronEnabled(!!p.cronEnabled);
    } catch (err) {
      if (err.response && (err.response.status === 404 || err.response.status === 403)) {
        navigate('/dashboard');
      } else {
        console.warn('Failed to load project:', err.message);
      }
    }
  }, [id, navigate, fetchBranches]);

  const loadDeployments = useCallback(() =>
    api.get(`/deploy/${id}`).then(r => setDeployments(r.data.deployments || [])).catch(() => {}),
  [id]);

  const loadEnvVars = useCallback(() =>
    api.get(`/env/${id}`).then(r => setEnvVars(r.data.envVars || [])).catch(() => {}),
  [id]);

  const loadDeployHooks = useCallback(() => {
    api.get(`/deploy/${id}/hooks`).then(r => setDeployHooks(r.data.hooks || [])).catch(() => {});
  }, [id]);

  const loadOutgoingWebhooks = useCallback(() => {
    api.get(`/deploy/${id}/webhooks`).then(r => setOutgoingWebhooks(r.data.webhooks || [])).catch(() => {});
  }, [id]);

  const loadDockerfile = useCallback(async () => {
    setDockerfileLoading(true);
    try {
      const res = await api.get(`/projects/${id}/dockerfile`);
      setDockerfile(res.data.dockerfile || '');
    } catch (err) {
      console.warn('Failed to load Dockerfile:', err.message);
    } finally {
      setDockerfileLoading(false);
    }
  }, [id]);

  const handleLintDockerfile = async () => {
    if (!dockerfile) return;
    setLinting(true);
    setDockerfileMessage('');
    try {
      const res = await api.post(`/projects/${id}/dockerfile/lint`, { dockerfile });
      setLintResults(res.data);
    } catch (err) {
      setDockerfileMessage('Linting failed: ' + (err.response?.data?.message || err.message));
    } finally {
      setLinting(false);
    }
  };

  const handleSaveDockerfile = async () => {
    setSavingDockerfile(true);
    setDockerfileMessage('');
    try {
      await api.post(`/projects/${id}/dockerfile`, { dockerfile });
      setDockerfileMessage('Dockerfile saved successfully! It will be used in your next deployment.');
      setTimeout(() => setDockerfileMessage(''), 4000);
    } catch (err) {
      setDockerfileMessage('Failed to save Dockerfile: ' + (err.response?.data?.message || err.message));
    } finally {
      setSavingDockerfile(false);
    }
  };

  const handleSaveRegions = async (updatedRegions) => {
    setRegionsSaving(true);
    setRegionsMessage('');
    try {
      const res = await api.patch(`/projects/${id}`, { regions: updatedRegions });
      setRegions(res.data.project.regions || ['us-ashburn-1']);
      setRegionsMessage('✓ Multi-region replication parameters updated successfully!');
      setTimeout(() => setRegionsMessage(''), 4000);
    } catch (err) {
      setRegionsMessage('Failed to save regions: ' + (err.response?.data?.message || err.message));
    } finally {
      setRegionsSaving(false);
    }
  };

  const handleSaveCron = async (enabledState, scheduleStr) => {
    setCronSaving(true);
    setCronMessage('');
    try {
      const res = await api.patch(`/projects/${id}`, {
        cronSchedule: scheduleStr.trim(),
        cronEnabled: enabledState
      });
      setCronSchedule(res.data.project.cronSchedule || '');
      setCronEnabled(!!res.data.project.cronEnabled);
      setCronMessage('✓ Scheduled deployments configuration updated successfully!');
      setTimeout(() => setCronMessage(''), 4000);
    } catch (err) {
      setCronMessage(err.response?.data?.message || err.message);
    } finally {
      setCronSaving(false);
    }
  };

  const handleLoadPreviews = useCallback(async () => {
    setPreviewsLoading(true);
    try {
      const res = await api.get(`/previews/${id}`);
      setPreviews(res.data.previews || []);
    } catch (err) {
      console.error('Failed to load previews:', err);
    } finally {
      setPreviewsLoading(false);
    }
  }, [id]);

  const connectToRuntimeLogs = () => {
    setRuntimeLogs([]);
    socketRef.current?.emit('join:runtime-logs', id);
  };

  useEffect(() => {
    if (!showDeployDropdown) return;
    const handleWindowClick = () => {
      setShowDeployDropdown(false);
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, [showDeployDropdown]);

  useEffect(() => {
    setTimeout(() => {
      loadProject();
      loadDeployments();
      loadEnvVars();
      loadDeployHooks();
      loadOutgoingWebhooks();
      loadDockerfile();
    }, 0);
  }, [loadProject, loadDeployments, loadEnvVars, loadDeployHooks, loadOutgoingWebhooks, loadDockerfile]);

  // Page-level persistent socket connection
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected, joining project:', id);
      socket.emit('join:project', id);
      socket.emit('join:metrics', id);
      // Re-join active deployment room if activeTab is logs
      const latestDep = deploymentsRef.current?.[0];
      if (activeTabRef.current === 'logs' && latestDep && (latestDep.status === 'building' || latestDep.status === 'queued')) {
        socket.emit('join:deployment', latestDep._id);
      }
      // Re-join runtime logs room if activeTab is runtime-logs
      if (activeTabRef.current === 'runtime-logs') {
        socket.emit('join:runtime-logs', id);
      }
    });

    socket.on('project-update', ({ deployments: updatedDeployments, project: updatedProject }) => {
      if (updatedProject) setProject(updatedProject);
      if (updatedDeployments) {
        setDeployments(updatedDeployments);
        const latest = updatedDeployments[0];
        if (latest) {
          if (latest.status === 'building' || latest.status === 'queued') {
            setDeploying(true);
            // Auto-join building log stream if on logs tab
            if (activeTabRef.current === 'logs') {
              socket.emit('join:deployment', latest._id);
            }
          } else {
            setDeploying(false);
          }
        }
      }
    });

    socket.on('log', ({ line }) => {
      setLogs(prev => [...prev, line]);
    });

    socket.on('runtime-log', ({ line }) => {
      setRuntimeLogs(prev => [...prev, line]);
    });

    socket.on('metrics', (stats) => {
      if (stats.cpu !== undefined) setCpuUsage(stats.cpu);
      if (stats.memMB !== undefined) setRamUsage(stats.memMB);
    });

    socket.on('connect_error', (err) => console.warn('Socket error:', err.message));

    socketRef.current = socket;

    return () => {
      console.log('[Socket] Cleaning up socket connection...');
      socket.emit('leave:metrics', id);
      socket.disconnect();
    };
  }, [id]);

  // Auto-switch to logs tab if a build is active on page load/refresh
  useEffect(() => {
    const latestDep = deployments?.[0];
    if (latestDep && (latestDep.status === 'building' || latestDep.status === 'queued')) {
      setTimeout(() => {
        setActiveTab('logs');
      }, 0);
    }
  }, [deployments?.[0]?._id, deployments?.[0]?.status]); // eslint-disable-line react-hooks/exhaustive-deps



  // Poller for previews in building state
  useEffect(() => {
    let interval;
    if (activeTab === 'previews' && previews.some(p => p.status === 'building')) {
      interval = setInterval(() => {
        handleLoadPreviews();
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [activeTab, previews, handleLoadPreviews]);

  useEffect(() => {
    if (activeTab === 'logs') logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, activeTab]);

  useEffect(() => {
    if (activeTab === 'runtime-logs') runtimeLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [runtimeLogs, activeTab]);

  useEffect(() => {
    if (project && architectMessages.length === 0) {
      setTimeout(() => {
        setArchitectMessages([
          {
            role: 'assistant',
            content: `🤖 Greetings! I am the SRE AI Architect for **${project.name}**. I oversee the container scaling, Nginx reverse proxies, SSL certificate crons, and the telemetry auto-healing monitor for this application.\n\nAsk me anything about how the infrastructure runs, click on a quick suggestion, or run a **DevOps Simulation** below!`
          }
        ]);
      }, 0);
    }
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (guideSubTab === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [architectMessages, guideSubTab]);

  const connectToLogs = async (deploymentId) => {
    if (connectingRef.current === deploymentId) return;
    connectingRef.current = deploymentId;

    try {
      setLogs([]);

      // Fetch any logs already stored in DB (handles page refresh / mid-build reconnect)
      try {
        const r = await api.get(`/deploy/${id}/${deploymentId}`);
        const stored = r.data.deployment?.logs || [];
        if (stored.length > 0) setLogs(stored);
      } catch (err) {
        console.warn('Failed to fetch stored logs from DB:', err.message);
      }

      socketRef.current?.emit('join:deployment', deploymentId);
    } finally {
      connectingRef.current = null;
    }
  };


  const handleDeploy = async (forceRebuild = false) => {
    // Client-side block for required missing env variables
    const missing = envVars.filter(e => e.hasPlaceholder && requiresUserInput(e.key));
    if (missing.length > 0) {
      const keys = missing.map(e => e.key).join(', ');
      setError(`Deployment Blocked: Please configure the required environment variables first: ${keys}`);
      setActiveTab('env');
      return;
    }

    setDeploying(true); setError(''); setActiveTab('logs'); setLogs([]);
    setActiveDeployment(null);
    setShowDiff(false);
    setShowDeployDropdown(false);
    try {
      const res = await api.post(`/deploy/${id}`, { forceRebuild });
      setActiveDeployment(res.data.deployment);
      connectToLogs(res.data.deployment._id);
    } catch (err) {
      setError(err.response?.data?.message || 'Deployment failed');
      setDeploying(false);
    }
  };

  const handleClearStuck = async () => {
    try {
      await api.post(`/projects/${id}/clear-stuck`);
      setError('');
      loadProject();
      loadDeployments();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset build status');
    }
  };

  const handleSyncStatus = async () => {
    try {
      const res = await api.post(`/projects/${id}/sync-status`);
      setProject(res.data.project);
      setError('');
      alert(`✅ ${res.data.message}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to sync project status');
    }
  };

  const viewLogs = async (dep) => {
    setActiveTab('logs');
    setActiveDeployment(dep);
    setShowDiff(false);
    if (dep.status === 'building' || dep.status === 'queued') {
      connectToLogs(dep._id);
      return;
    }
    try {
      const res = await api.get(`/deploy/${id}/${dep._id}`);
      const fetched = res.data.deployment;
      setLogs(fetched?.logs || []);
      setActiveDeployment(fetched);
    } catch { setLogs(['Failed to load logs.']); }
  };

  const fetchVolumeDetails = async () => {
    if (!id) return;
    setVolumeLoading(true);
    setVolumeError(null);
    try {
      const res = await api.get(`/projects/${id}/volume/files`);
      setVolumeDetails(res.data);
    } catch (err) {
      console.error('[Volume fetch error]', err);
      setVolumeError(err.response?.data?.message || 'Failed to fetch volume files');
    } finally {
      setVolumeLoading(false);
    }
  };

  const handleClearVolume = async () => {
    if (!window.confirm('WARNING: Are you sure you want to delete all files in the persistent volume? This will restart your container and cannot be undone.')) {
      return;
    }
    setVolumeActionLoading(true);
    try {
      await api.post(`/projects/${id}/volume/clear`);
      await fetchVolumeDetails();
      alert('Volume cleared and container restarted successfully!');
    } catch (err) {
      console.error('[Volume clear error]', err);
      alert(err.response?.data?.message || 'Failed to clear volume');
    } finally {
      setVolumeActionLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      setSaveStatus('saving');
      await api.patch(`/projects/${id}`, settings);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch { setSaveStatus('error'); setTimeout(() => setSaveStatus(''), 3000); }
  };

  const handleAddEnv = async () => {
    if (!envKey.trim() || !envValue.trim()) return;
    try {
      await api.post(`/env/${id}`, { key: envKey.trim(), value: envValue.trim(), scopes: envScopes });
      setEnvKey(''); setEnvValue('');
      setEnvScopes(['production', 'preview', 'development']);
      setEnvChanged(true);
      loadEnvVars();
    } catch (err) { setError(err.response?.data?.message || 'Failed to add variable'); }
  };

  const handleQuickAddEnv = async (dep = activeDeployment) => {
    const missingVar = dep?.aiDiagnosis?.missingEnvVar;
    if (!missingVar || !quickEnvValue.trim()) return;
    const key = missingVar.trim();
    const value = quickEnvValue.trim();
    setQuickEnvLoading(true);
    setError('');
    try {
      await api.post(`/env/${id}`, { key, value });
      setQuickEnvValue('');
      setEnvChanged(true);
      await loadEnvVars();
      handleDeploy(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add environment variable');
    } finally {
      setQuickEnvLoading(false);
    }
  };

  const handleSaveNotes = async (depId) => {
    setNotesSaving(true);
    try {
      const res = await api.put(`/deploy/${id}/${depId}/notes`, { notes: tempNotes });
      setDeployments(prev => prev.map(d => d._id === depId ? { ...d, notes: res.data.deployment.notes } : d));
      setEditingNotesDepId(null);
      setTempNotes('');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to save release notes');
    } finally {
      setNotesSaving(false);
    }
  };

  const handleBulkImport = async () => {
    const lines = bulkEnv.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'));
    if (lines.length === 0) { setError('No valid KEY=VALUE lines found.'); return; }
    setBulkImporting(true);
    setError('');
    try {
      const vars = lines.map(line => {
        const eqIdx = line.indexOf('=');
        return { key: line.slice(0, eqIdx).trim(), value: line.slice(eqIdx + 1).trim() };
      }).filter(v => v.key);
      const res = await api.post(`/env/${id}/bulk`, { vars });
      setSaveStatus(`✅ Imported ${res.data.created} new, updated ${res.data.updated} variables`);
      setTimeout(() => setSaveStatus(''), 4000);
      setEnvChanged(true);
      setBulkEnv(''); setShowBulk(false); loadEnvVars();
    } catch (err) {
      setError(err.response?.data?.message || 'Bulk import failed. Check your format.');
    } finally {
      setBulkImporting(false);
    }
  };

  const handleCreateDeployHook = async () => {
    if (!newHookName.trim()) return;
    try {
      await api.post(`/deploy/${id}/hooks`, { name: newHookName, branch: newHookBranch });
      setNewHookName('');
      loadDeployHooks();
    } catch (err) { setError(err.response?.data?.message || 'Failed to create deploy hook'); }
  };

  const handleDeleteDeployHook = async (hookId) => {
    if (!window.confirm('Delete this deploy hook?')) return;
    try {
      await api.delete(`/deploy/${id}/hooks/${hookId}`);
      loadDeployHooks();
    } catch (err) {
      console.error('Failed to delete deploy hook:', err);
    }
  };

  const handleCreateOutgoingWebhook = async () => {
    if (!newHookUrl.trim()) return;
    try {
      await api.post(`/deploy/${id}/webhooks`, { name: `${newHookType} Alert`, url: newHookUrl, type: newHookType, events: newHookEvents });
      setNewHookUrl('');
      loadOutgoingWebhooks();
    } catch (err) { setError(err.response?.data?.message || 'Failed to create webhook'); }
  };

  const handleDeleteOutgoingWebhook = async (webhookId) => {
    if (!window.confirm('Delete this webhook notification?')) return;
    try {
      await api.delete(`/deploy/${id}/webhooks/${webhookId}`);
      loadOutgoingWebhooks();
    } catch (err) {
      console.error('Failed to delete webhook:', err);
    }
  };

  // ── Container lifecycle controls ──────────────────────────────────────────────
  const handleContainerAction = async (action) => {
    setContainerAction(action + 'ing');
    setError('');
    try {
      await api.post(`/deploy/${id}/${action}`);
      setSaveStatus(`✅ Container ${action}ped successfully`);
      setTimeout(() => setSaveStatus(''), 3000);
      loadProject();
    } catch (err) {
      setError(err.response?.data?.message || `Failed to ${action} container`);
    } finally {
      setContainerAction(null);
    }
  };

  const handleCancelDeploy = async () => {
    if (!window.confirm('Cancel the current deployment?')) return;
    setContainerAction('cancelling');
    setError('');
    try {
      await api.post(`/deploy/${id}/cancel`);
      setSaveStatus('🛑 Deployment cancelled');
      setTimeout(() => setSaveStatus(''), 3000);
      loadDeployments();
      loadProject();
      clearInterval(pollRef.current);
      setDeploying(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel deployment');
    } finally {
      setContainerAction(null);
    }
  };

  // ── Format milliseconds into "1m 23s" ─────────────────────────────────────────
  const formatDuration = (ms) => {
    if (!ms || ms < 0) return null;
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  const handleAiAutoDetect = async () => {
    setAiScanning(true);
    setError('');
    setEnvWarnings([]);
    setEnvCollisions([]);
    try {
      const res = await api.post(`/ai/${id}/discover-env`);
      if (res.data.detectedVars && res.data.detectedVars.length > 0) {
        loadEnvVars();
        setEnvWarnings(res.data.securityWarnings || []);
        setEnvCollisions(res.data.collisions || []);
        alert(`Successfully auto-detected and configured ${res.data.detectedVars.length} variables!`);
      } else {
        alert("No new environment variables detected in the codebase.");
      }
    } catch (err) {
      setError(err.response?.data?.message || 'AI detection failed');
    } finally {
      setAiScanning(false);
    }
  };

  const handleEditClick = (key) => {
    setEnvKey(key);
    setEnvValue('');
    setShowBulk(false);
    const existing = envVars.find(e => e.key === key);
    if (existing && existing.scopes) {
      setEnvScopes(existing.scopes);
    } else {
      setEnvScopes(['production', 'preview', 'development']);
    }
    setTimeout(() => {
      const valInput = document.querySelector('input[placeholder="value"]');
      if (valInput) valInput.focus();
    }, 50);
  };

  const handleDeleteEnv = async (key) => {
    if (!window.confirm(`Delete ${key}?`)) return;
    await api.delete(`/env/${id}/${key}`);
    setEnvVars(prev => prev.filter(e => e.key !== key));
    setEnvChanged(true);
  };

  const handleLoadEnvHistory = async () => {
    const nextShow = !showHistory;
    setShowHistory(nextShow);
    if (nextShow) {
      setHistoryLoading(true);
      try {
        const res = await api.get(`/env/${id}/history`);
        setEnvHistory(res.data.history || []);
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load environment variable history');
      } finally {
        setHistoryLoading(false);
      }
    }
  };

  const handleRestoreEnvHistory = async (historyId) => {
    try {
      setSaveStatus('restoring');
      await api.post(`/env/${id}/history/${historyId}/restore`);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 3000);
      setEnvChanged(true);
      const histRes = await api.get(`/env/${id}/history`);
      setEnvHistory(histRes.data.history || []);
      loadEnvVars();
    } catch (err) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(''), 3000);
      setError(err.response?.data?.message || 'Failed to restore environment variable');
    }
  };

  const handleShowClick = async (key, envId) => {
    if (showVal[envId]) {
      setShowVal(prev => ({ ...prev, [envId]: false }));
    } else {
      try {
        const res = await api.get(`/env/${id}/${key}/reveal`);
        setDecryptedVals(prev => ({ ...prev, [envId]: res.data.value }));
        setShowVal(prev => ({ ...prev, [envId]: true }));
      } catch (err) {
        console.error('Failed to reveal secret:', err.message);
        alert('Failed to decrypt secret value. Please check your ENCRYPTION_KEY on the server.');
      }
    }
  };

  const handleDeleteProject = async () => {
    if (!window.confirm(`Permanently delete "${project?.name}"? This cannot be undone.`)) return;
    await api.delete(`/projects/${id}`);
    navigate('/dashboard');
  };

  const handleResizeLimits = async () => {
    setResizing(true);
    setError('');
    try {
      const res = await api.post(`/projects/${id}/resize-limits`, {
        cpuLimit: parseFloat(cpuLimit),
        ramLimitMB: parseInt(ramLimitMB)
      });
      alert(res.data.message || 'Container capacity limits resized successfully!');
      loadProject();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to apply new resource limits');
    } finally {
      setResizing(false);
    }
  };

  // ⏪ Rollback to a specific past deployment
  const handleRollback = async (dep) => {
    if (!window.confirm(`Roll back to deployment from ${new Date(dep.createdAt).toLocaleDateString()}? Current live version will be replaced.`)) return;
    setRollingBack(dep._id);
    setError('');
    try {
      const res = await api.post(`/deploy/${id}/rollback/${dep._id}`);
      setActiveTab('logs');
      setLogs([]);
      connectToLogs(res.data.deployment._id);
      loadDeployments();
    } catch (err) {
      setError(err.response?.data?.message || 'Rollback failed');
    } finally {
      setRollingBack(null);
    }
  };

  // 🛡️ Run vulnerability scan
  const handleVulnScan = async () => {
    setVulnLoading(true);
    setVulnData(null);
    setVulnFixData(null);
    try {
      const res = await api.get(`/vuln/${id}`);
      setVulnData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Vulnerability scan failed');
    } finally {
      setVulnLoading(false);
    }
  };

  // 🧠 Run readiness check
  const handleReadinessCheck = async () => {
    setReadinessLoading(true);
    setReadiness(null);
    try {
      const res = await api.post(`/projects/${id}/readiness`);
      setReadiness(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Readiness check failed');
    } finally {
      setReadinessLoading(false);
    }
  };

  // 📊 Load build trends
  const handleLoadTrends = async () => {
    setTrendsLoading(true);
    try {
      const res = await api.get(`/analytics/${id}/build-trends`);
      setBuildTrends(res.data);
    } catch (err) {
      console.warn('Build trends unavailable:', err.message);
    } finally {
      setTrendsLoading(false);
    }
  };

  // 💰 Load cost estimate
  const handleLoadCostEstimate = async () => {
    setCostLoading(true);
    try {
      const res = await api.get(`/metrics/${id}/cost-estimate`);
      setCostData(res.data);
    } catch (err) {
      console.warn('Cost estimate unavailable:', err.message);
    } finally {
      setCostLoading(false);
    }
  };

  // 🫀 Load runtime health
  const handleLoadHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await api.get(`/health/${id}`);
      setHealthData(res.data);
    } catch (err) {
      console.warn('Health status unavailable:', err.message);
    } finally {
      setHealthLoading(false);
    }
  };

  // Generate vulnerability AI fix commands
  const handleVulnAutoFix = async () => {
    setVulnFixLoading(true);
    try {
      const res = await api.post(`/vuln/${id}/auto-fix`);
      setVulnFixData(res.data.fixPatch);
    } catch (err) {
      setError(err.response?.data?.message || 'Auto-fix generation failed');
    } finally {
      setVulnFixLoading(false);
    }
  };

  // Execute vulnerability auto-fix patches and trigger redeploy
  const handleApplyVulnFix = async () => {
    setApplyingVulnFix(true);
    try {
      const res = await api.post(`/vuln/${id}/apply-fix`);
      alert('Security patches applied successfully! Starting fresh cache-bypassed SRE build...');
      
      // Navigate to logs tab to view rebuild progress in real-time
      setActiveTab('logs');
      if (res.data.deployment) {
        setActiveDeployment(res.data.deployment);
        setDeploying(true);
        connectToLogs(res.data.deployment._id);
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to apply security patches.');
    } finally {
      setApplyingVulnFix(false);
    }
  };

  const handleCreatePreview = async (e) => {
    e.preventDefault();
    if (!newPreviewPR || !newPreviewBranch) return;
    setCreatingPreview(true);
    try {
      await api.post(`/previews/${id}`, {
        prNumber: parseInt(newPreviewPR),
        prBranch: newPreviewBranch
      });
      setNewPreviewPR('');
      setNewPreviewBranch('');
      handleLoadPreviews();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to create preview');
    } finally {
      setCreatingPreview(false);
    }
  };

  const handleDestroyPreview = async (prNumber) => {
    if (!window.confirm(`Are you sure you want to destroy preview for PR #${prNumber}?`)) return;
    try {
      await api.delete(`/previews/${id}/${prNumber}`);
      handleLoadPreviews();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to destroy preview');
    }
  };

  const handleGenerateAiDocs = async () => {
    setAiDocsLoading(true);
    setAiDocsError('');
    setCommitStatus('');
    setCommitMessage('');
    try {
      const res = await api.post(`/projects/${id}/readme`);
      setAiDocsData(res.data);
    } catch (err) {
      setAiDocsError(err.response?.data?.message || err.message || 'Failed to generate documentation.');
    } finally {
      setAiDocsLoading(false);
    }
  };

  const handleCommitAiDocs = async () => {
    setCommitStatus('committing');
    setCommitMessage('');
    try {
      const res = await api.post(`/projects/${id}/readme/commit`);
      setCommitStatus('committed');
      setCommitMessage(res.data.message || 'Successfully committed and pushed README.md to GitHub!');
    } catch (err) {
      setCommitStatus('error');
      setCommitMessage(err.response?.data?.message || err.message || 'Failed to commit README.md to GitHub.');
    }
  };

  const handleAiScanMissingVars = async () => {
    setMissingVarsLoading(true);
    setMissingVars(null);
    setEnvWarnings([]);
    setEnvCollisions([]);
    try {
      const res = await api.get(`/env/${id}/ai-scan`);
      setMissingVars(res.data.missingVars || []);
      setEnvWarnings(res.data.securityWarnings || []);
      setEnvCollisions(res.data.collisions || []);
      if (res.data.missingVars?.length === 0 && (res.data.securityWarnings?.length || 0) === 0 && (res.data.collisions?.length || 0) === 0) {
        alert('✨ All environment variables referenced in code are already configured in this vault!');
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to scan environment variables');
    } finally {
      setMissingVarsLoading(false);
    }
  };

  const handleAddMissingVarDirect = async (key) => {
    const value = prompt(`Enter value for environment variable: ${key}`);
    if (value === null || value === '') return; // cancelled/empty
    setAddingMissingVar(key);
    try {
      await api.post(`/env/${id}`, { key, value });
      setMissingVars(prev => prev.filter(v => v !== key));
      setEnvChanged(true);
      loadEnvVars();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add environment variable');
    } finally {
      setAddingMissingVar(null);
    }
  };

  // Auto-run background scans (readiness check, CVE vulnerabilities, missing env variables) as soon as project loads
  useEffect(() => {
    if (project) {
      if (!readiness && !readinessLoading) {
        setTimeout(() => {
          handleReadinessCheck();
        }, 0);
      }
      if (!vulnData && !vulnLoading) {
        setTimeout(() => {
          handleVulnScan();
        }, 0);
      }
      if (missingVars === null && !missingVarsLoading) {
        setTimeout(() => {
          handleAiScanMissingVars();
        }, 0);
      }
    }
  }, [project?._id, readiness, readinessLoading, vulnData, vulnLoading, missingVars, missingVarsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tab switch logic to auto-load tab details and clean up socket rooms on tab change
  useEffect(() => {
    const latestDep = deployments?.[0];
    if (activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      if (latestDep) {
        if (latestDep.status === 'building' || latestDep.status === 'queued') {
          setTimeout(() => {
            connectToLogs(latestDep._id);
          }, 0);
        } else if (logs.length === 0) {
          setTimeout(() => {
            viewLogs(latestDep);
          }, 0);
        }
      }
    } else if (activeTab === 'runtime-logs') {
      setTimeout(() => {
        connectToRuntimeLogs();
      }, 0);
    } else if (activeTab === 'previews') {
      setTimeout(() => {
        handleLoadPreviews();
      }, 0);
    } else if (activeTab === 'advisor') {
      if (!readiness && !readinessLoading) {
        setTimeout(() => {
          handleReadinessCheck();
        }, 0);
      }
    } else if (activeTab === 'security') {
      if (!vulnData && !vulnLoading) {
        setTimeout(() => {
          handleVulnScan();
        }, 0);
      }
    } else if (activeTab === 'env') {
      if (missingVars === null && !missingVarsLoading) {
        setTimeout(() => {
          handleAiScanMissingVars();
        }, 0);
      }
    } else if (activeTab === 'settings') {
      setTimeout(() => {
        fetchVolumeDetails();
      }, 0);
    }

    return () => {
      if (activeTab === 'runtime-logs') {
        socketRef.current?.emit('leave:runtime-logs');
      }
      if (activeTab === 'logs' && latestDep) {
        socketRef.current?.emit('leave:deployment', latestDep._id);
      }
    };
  }, [activeTab, deployments?.[0]?._id, handleLoadPreviews, readiness, readinessLoading, vulnData, vulnLoading, missingVars, missingVarsLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return (
    <div className="launchlive-container flex-center" style={{ minHeight: '100vh' }}>
      <div className="loading-spinner" style={{ width: 40, height: 40 }} />
    </div>
  );

  const renderSidebarBadge = (itemId) => {
    // 1. Deployments / Build Logs Tab
    if (itemId === 'deployments' || itemId === 'logs') {
      const activeDeploy = deployments?.some(d => d.status === 'queued' || d.status === 'building');
      if (activeDeploy) {
        return (
          <span className="lp-sidebar-badge pulse-blue" title="Deployment in progress">
            <span className="pulse-dot-blue"></span>
            BUILDING
          </span>
        );
      }
    }
    // 2. PR Previews Tab
    if (itemId === 'previews') {
      const count = project?.previews?.length || previews?.length || 0;
      if (count > 0) {
        return (
          <span className="lp-sidebar-badge count-purple" title={`${count} active preview environments`}>
            {count}
          </span>
        );
      }
    }
    // 3. Live Metrics Tab
    if (itemId === 'metrics') {
      if (project?.status === 'live') {
        return (
          <span className="lp-sidebar-badge pulse-green" title="Systems online and responding">
            <span className="pulse-dot-green"></span>
            LIVE
          </span>
        );
      }
    }
    // 4. Environment Tab
    if (itemId === 'env') {
      const warningCount = (envWarnings?.length || 0) + (envCollisions?.length || 0) + (missingVars?.length || 0);
      if (warningCount > 0) {
        return (
          <span className="lp-sidebar-badge count-amber" title={`${warningCount} configurations to review`}>
            ⚠️ {warningCount}
          </span>
        );
      }
    }
    // 5. Security Tab
    if (itemId === 'security') {
      const critical = vulnData?.summary?.critical || 0;
      const high = vulnData?.summary?.high || 0;
      const totalIssues = critical + high;
      if (totalIssues > 0) {
        return (
          <span className="lp-sidebar-badge count-red" title={`${totalIssues} high-severity vulnerabilities`}>
            {totalIssues}
          </span>
        );
      }
    }
    return null;
  };

  const domain = import.meta.env.VITE_DOMAIN || 'launchlive.in';
  const getDeployUrl = () => {
    if (!project.subdomain) return null;
    if (project.customDomain && (project.customDomainStatus === 'active' || project.customDomainStatus === 'dns_verified')) {
      const isWildcard = project.customDomain.includes('nip.io') || project.customDomain.includes('sslip.io');
      const isSslActive = project.sslStatus === 'active';
      const scheme = (isSslActive && !isWildcard) ? 'https' : 'http';
      return `${scheme}://${project.customDomain}`;
    }
    return `https://${project.subdomain}.${domain}`;
  };
  const renderAiDiagnosis = (dep) => {
    if (!dep || dep.status !== 'failed' || !dep.aiDiagnosis) return null;
    
    // Determine if we can jump to error
    const hasErrors = dep.logs && dep.logs.some(line => isErrorLine(line));
    
    return (
      <div className="lp-card glass fade-in" style={{
        padding: '24px',
        borderLeft: '4px solid #ef4444',
        background: 'rgba(239, 68, 68, 0.02)',
        borderRadius: 16,
        border: '1px solid rgba(239, 68, 68, 0.1)',
        borderLeftWidth: 4,
        display: 'grid',
        gap: 16,
        boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🤖</span>
            <div>
              <h4 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-main)', margin: 0, letterSpacing: '0.02em' }}>
                SRE Build Diagnosis
              </h4>
              <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                ACTION REQUIRED
              </div>
            </div>
          </div>
          <span style={{
            fontSize: 11,
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#ef4444',
            padding: '4px 10px',
            borderRadius: 20,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            {dep.aiDiagnosis.summary?.split(':')[0] || 'Build Error'}
          </span>
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            Root Cause
          </div>
          <p style={{ color: '#f1f5f9', fontSize: 13, lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
            {dep.aiDiagnosis.cause}
          </p>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Resolution Steps
          </div>
          <div style={{
            background: 'rgba(255,255,255,0.01)',
            border: '1px solid rgba(255,255,255,0.04)',
            borderRadius: 12,
            padding: '16px 20px',
            fontSize: 13,
            lineHeight: 1.7,
            color: '#cbd5e1'
          }}>
            {formatMessageContent(dep.aiDiagnosis.fix)}
          </div>
        </div>

        {dep.aiDiagnosis.missingEnvVar && (
          <div style={{
            marginTop: '8px',
            padding: '16px',
            background: 'rgba(56, 189, 248, 0.03)',
            border: '1px solid rgba(56, 189, 248, 0.1)',
            borderRadius: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              ⚡ Configure <code style={{ color: 'var(--accent-primary)', fontSize: '13px', background: 'rgba(56, 189, 248, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>{dep.aiDiagnosis.missingEnvVar}</code> directly:
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <input
                type="text"
                value={quickEnvValue}
                onChange={(e) => setQuickEnvValue(e.target.value)}
                placeholder={`Enter value for ${dep.aiDiagnosis.missingEnvVar}`}
                style={{
                  flex: 1,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '8px 12px',
                  color: '#fff',
                  fontSize: '13px'
                }}
              />
              <button
                onClick={handleQuickAddEnv}
                disabled={quickEnvLoading || !quickEnvValue.trim()}
                className="lp-btn-primary"
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                {quickEnvLoading ? 'Adding...' : 'Add & Redeploy'}
              </button>
            </div>
          </div>
        )}

        {dep.aiDiagnosis.commands && dep.aiDiagnosis.commands.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Copy-Paste Commands
              </div>
              <button
                onClick={() => {
                  const allCmds = dep.aiDiagnosis.commands.join('\n');
                  navigator.clipboard.writeText(allCmds);
                  const btn = document.getElementById('copy-all-btn-diag');
                  if (btn) {
                    btn.innerText = 'Copied All!';
                    setTimeout(() => { btn.innerText = 'Copy All'; }, 2000);
                  }
                }}
                id="copy-all-btn-diag"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-primary)',
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                Copy All
              </button>
            </div>
            
            <div style={{ display: 'grid', gap: 8 }}>
              {dep.aiDiagnosis.commands.map((cmd, idx) => (
                <div key={idx} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: '#040406',
                  border: '1px solid rgba(255,255,255,0.03)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: 12
                }}>
                  <span style={{ color: '#38bdf8', overflowX: 'auto', whiteSpace: 'nowrap', marginRight: 16 }}>
                    <span style={{ color: '#64748b', marginRight: 8, userSelect: 'none' }}>$</span>
                    {cmd}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(cmd);
                      const btn = document.getElementById(`copy-btn-diag-${idx}`);
                      if (btn) {
                        btn.innerText = 'Copied';
                        setTimeout(() => { btn.innerText = 'Copy'; }, 2000);
                      }
                    }}
                    id={`copy-btn-diag-${idx}`}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.05)',
                      borderRadius: 4,
                      color: 'var(--text-dim)',
                      fontSize: 10,
                      padding: '3px 8px',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    Copy
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '12px', marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px', flexWrap: 'wrap' }}>
          {hasErrors && (
            <button
              onClick={() => {
                setActiveTab('logs');
                viewLogs(dep);
                setTimeout(() => {
                  jumpToFirstError();
                }, 250);
              }}
              className="lp-btn-primary"
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#f87171'
              }}
            >
              🚨 Jump to Error
            </button>
          )}
          <button
            onClick={() => handleDeploy(false)}
            className="lp-btn-primary"
            style={{
              padding: '8px 16px',
              fontSize: '13px',
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.15)',
              color: '#fff'
            }}
          >
            🔄 Redeploy App
          </button>
        </div>
      </div>
    );
  };
  const renderAiDocsTab = () => {
    return (
      <div style={{ display: 'grid', gap: 20 }}>
        {/* Intro Card */}
        <div className="lp-card glass" style={{ 
          padding: 28,
          borderLeft: '4px solid var(--accent-primary)',
          background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.05) 0%, rgba(129, 140, 248, 0.02) 100%)'
        }}>
          <h3 style={{ fontSize: 16, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            📝 AI Documentation & Architecture Flows
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
            LaunchLive traverses your workspace folder tree, identifies APIs and configurations, and invokes Gemini to construct a premium README.md, complete with an ASCII architecture map and REST API endpoint specifications.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button 
              className="lp-btn-primary" 
              onClick={handleGenerateAiDocs} 
              disabled={aiDocsLoading}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              {aiDocsLoading ? (
                <>
                  <div className="loading-spinner" style={{ width: 16, height: 16, borderColor: '#fff', borderTopColor: 'transparent' }} />
                  Analyzing Workspace Tree...
                </>
              ) : (
                <>🔮 Generate README & Architecture Flow</>
              )}
            </button>
            {aiDocsData && (
              <button 
                className="lp-btn-secondary" 
                onClick={handleCommitAiDocs} 
                disabled={commitStatus === 'committing'}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
              >
                {commitStatus === 'committing' ? (
                  <>
                    <div className="loading-spinner" style={{ width: 14, height: 14 }} />
                    Pushing to GitHub...
                  </>
                ) : (
                  <>💾 Commit & Push README to GitHub</>
                )}
              </button>
            )}
          </div>
          
          {commitMessage && (
            <div className={`lp-status-bar ${commitStatus === 'committed' ? 'success' : 'error'}`} style={{ marginTop: 16, fontSize: 12.5 }}>
              {commitStatus === 'committed' ? '✓ ' : '✕ '}{commitMessage}
            </div>
          )}
          
          {aiDocsError && (
            <div className="lp-status-bar error" style={{ marginTop: 16, fontSize: 12.5 }}>
              ✕ {aiDocsError}
            </div>
          )}
        </div>

        {/* Results Block */}
        {aiDocsData ? (
          <div className="lp-card glass" style={{ padding: 28, display: 'grid', gap: 20 }}>
            {/* Sub-tabs header */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', paddingBottom: 10, gap: 20 }}>
              {[
                { id: 'readme', label: '📖 README.md' },
                { id: 'endpoints', label: '⚡ API Endpoints' },
                { id: 'reference', label: '📘 API Reference Docs' },
              ].map(sub => (
                <button
                  key={sub.id}
                  onClick={() => setAiDocsSubTab(sub.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: aiDocsSubTab === sub.id ? 'var(--accent-primary)' : 'var(--text-dim)',
                    fontWeight: aiDocsSubTab === sub.id ? 700 : 500,
                    fontSize: 13.5,
                    cursor: 'pointer',
                    padding: '6px 0',
                    borderBottom: aiDocsSubTab === sub.id ? '2px solid var(--accent-primary)' : 'none',
                    transition: 'all 0.2s'
                  }}
                >
                  {sub.label}
                </button>
              ))}
            </div>

            {/* Sub-tab Content */}
            <div style={{ minHeight: 250 }}>
              {aiDocsSubTab === 'readme' && (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div className="flex-between">
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>PREVIEW OF GENERATED README.MD</span>
                    <button 
                      className="lp-btn-secondary" 
                      style={{ padding: '4px 10px', fontSize: 11, height: 'auto' }}
                      onClick={() => {
                        navigator.clipboard.writeText(aiDocsData.readme);
                        alert('README.md markdown copied to clipboard!');
                      }}
                    >
                      📋 Copy Markdown
                    </button>
                  </div>
                  <pre style={{
                    background: '#040406',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 20,
                    overflow: 'auto',
                    fontFamily: 'monospace',
                    fontSize: 12.5,
                    maxHeight: 500,
                    color: 'var(--text-main)',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {aiDocsData.readme}
                  </pre>
                </div>
              )}

              {aiDocsSubTab === 'endpoints' && (
                <div style={{ display: 'grid', gap: 16 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>DETECTED API ENDPOINTS</div>
                  {(!aiDocsData.apiEndpoints || aiDocsData.apiEndpoints.length === 0) ? (
                    <div style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: '40px 0' }}>
                      No active API endpoints detected in this repository stack.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 12 }}>
                      {aiDocsData.apiEndpoints.map((ep, idx) => {
                        const m = (ep.method || 'GET').toUpperCase();
                        const mColors = {
                          GET: { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.2)', text: '#10b981' },
                          POST: { bg: 'rgba(56,189,248,0.1)', border: 'rgba(56,189,248,0.2)', text: '#38bdf8' },
                          PUT: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.2)', text: '#f59e0b' },
                          DELETE: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.2)', text: '#ef4444' }
                        };
                        const c = mColors[m] || { bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)', text: 'var(--text-muted)' };
                        return (
                          <div key={idx} style={{ 
                            padding: '14px 16px', 
                            background: 'rgba(255,255,255,0.01)', 
                            border: '1px solid var(--border)', 
                            borderRadius: 8,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 14
                          }}>
                            <span style={{ 
                              padding: '4px 10px', 
                              borderRadius: 4, 
                              fontSize: 11, 
                              fontWeight: 700, 
                              background: c.bg, 
                              border: `1px solid ${c.border}`, 
                              color: c.text,
                              fontFamily: 'monospace'
                            }}>
                              {m}
                            </span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-main)' }}>{ep.route}</div>
                              <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 2 }}>{ep.description}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {aiDocsSubTab === 'reference' && (
                <div style={{ display: 'grid', gap: 12 }}>
                  <div className="flex-between">
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>PREVIEW OF FULL API DOCUMENTATION</span>
                    <button 
                      className="lp-btn-secondary" 
                      style={{ padding: '4px 10px', fontSize: 11, height: 'auto' }}
                      onClick={() => {
                        navigator.clipboard.writeText(aiDocsData.apiDocs);
                        alert('API Reference markdown copied to clipboard!');
                      }}
                    >
                      📋 Copy Markdown
                    </button>
                  </div>
                  <pre style={{
                    background: '#040406',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 20,
                    overflow: 'auto',
                    fontFamily: 'monospace',
                    fontSize: 12.5,
                    maxHeight: 500,
                    color: 'var(--text-main)',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {aiDocsData.apiDocs}
                  </pre>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="lp-card glass" style={{ 
            padding: 40, 
            textAlign: 'center', 
            color: 'var(--text-dim)', 
            fontSize: 13.5,
            border: '1px dashed var(--border)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12
          }}>
            <span>No documentation generated yet. Click "Generate" above to scan your project code layers.</span>
          </div>
        )}
      </div>
    );
  };
  const deployUrl = getDeployUrl();

  return (
    <div className="launchlive-container">
      {/* Header */}
      <header className="lp-header">
        <div className="lp-header-inner">
          <div className="lp-header-left">
            <button className="lp-btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => navigate('/dashboard')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              Dashboard
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 8 }}>
              <button
                onClick={() => setIsPaletteOpen(true)}
                className="lp-btn-secondary"
                style={{ padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}
              >
                🔍 Search... <kbd style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 4px', borderRadius: 3, fontSize: 10, fontFamily: 'var(--font-mono)' }}>Ctrl+K</kbd>
              </button>
              <NotificationCenter user={user} />
            </div>
            <div className="lp-header-separator" />
            <span className="lp-header-project-name">{project.name}</span>
            <span className={`lp-badge ${deploying ? 'building' : (project.status || 'idle')}`}>
              {deploying ? 'building' : (project.status || 'idle')}
            </span>
            {/* Quick Repair: show Fix Status button when project shows failed but history has a success */}
            {!deploying && project.status === 'failed' && (
              <button
                onClick={handleSyncStatus}
                title="Repair project status from deployment history"
                className="lp-header-pill-btn"
                style={{
                  background: 'rgba(52,211,153,0.1)', color: '#34d399',
                  border: '1px solid rgba(52,211,153,0.25)',
                }}
              >
                🔧 Fix Status
              </button>
            )}
            {/* Health Score Pill */}
            {project.lastHealthScore !== undefined && (
              <span 
                className="lp-header-pill"
                style={{
                  background: project.lastHealthScore >= 80 ? 'rgba(52,211,153,0.15)' : project.lastHealthScore >= 50 ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)',
                  color: project.lastHealthScore >= 80 ? '#34d399' : project.lastHealthScore >= 50 ? '#fbbf24' : '#f87171',
                  border: `1px solid ${project.lastHealthScore >= 80 ? 'rgba(52,211,153,0.3)' : project.lastHealthScore >= 50 ? 'rgba(251,191,36,0.3)' : 'rgba(248,113,113,0.3)'}`,
                }} 
                onClick={() => { setActiveTab('runtime-logs'); handleLoadHealth(); }} 
                title="Click to view health status"
              >
                {project.lastHealthScore >= 80 ? '🟢' : project.lastHealthScore >= 50 ? '🟡' : '🔴'}
                Health {project.lastHealthScore}%
              </span>
            )}
            {/* Vuln Summary Pill */}
            {project.vulnSummary && (project.vulnSummary.critical > 0 || project.vulnSummary.high > 0) && (
              <span 
                className="lp-header-pill"
                style={{
                  background: 'rgba(248,113,113,0.15)', color: '#f87171',
                  border: '1px solid rgba(248,113,113,0.3)',
                }} 
                onClick={() => setActiveTab('security')} 
                title="Click to view vulnerabilities"
              >
                ⚠️ {project.vulnSummary.critical} Critical · {project.vulnSummary.high} High CVEs
              </span>
            )}
          </div>
          <div className="lp-header-right">
            {branches.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>SWITCH BRANCH:</span>
                <select
                  value={project?.branch || 'main'}
                  onChange={async (e) => {
                    const newBranch = e.target.value;
                    if (window.confirm(`Are you sure you want to switch branch to "${newBranch}" and deploy?`)) {
                      try {
                        setDeploying(true);
                        await api.patch(`/projects/${id}`, { branch: newBranch });
                        setProject(prev => ({ ...prev, branch: newBranch }));
                        setSettings(prev => ({ ...prev, branch: newBranch }));
                        handleDeploy();
                      } catch (err) {
                        alert(err.response?.data?.message || 'Failed to switch branch and deploy');
                      } finally {
                        setDeploying(false);
                      }
                    }
                  }}
                  className="lp-input"
                  style={{ width: 140, padding: '4px 10px', height: 32, fontSize: 13, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-main)', cursor: 'pointer', borderRadius: 6 }}
                  disabled={deploying}
                >
                  {branches.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            )}
            {envVars.some(e => e.hasPlaceholder && requiresUserInput(e.key)) && (
              <div 
                style={{ 
                  color: '#fca5a5', 
                  fontSize: 12, 
                  background: 'rgba(239, 68, 68, 0.15)', 
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  padding: '5px 10px',
                  borderRadius: 6,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginRight: 8
                }}
              >
                ⚠️ Missing Required Envs
              </div>
            )}
            {deployUrl && (
              <a href={deployUrl} target="_blank" rel="noreferrer" className="lp-btn-secondary" style={{ padding: '6px 14px', fontSize: 13 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                Visit
              </a>
            )}
            <div className={`lp-btn-primary ${deploying ? 'animate-pulse-cyan' : ''}`} style={{ 
              position: 'relative', 
              display: 'flex', 
              alignItems: 'stretch', 
              borderRadius: 6, 
              overflow: 'visible',
              padding: 0,
              border: 'none',
              boxShadow: '0 4px 14px rgba(56,189,248,0.25)' 
            }}>
              <button 
                onClick={() => handleDeploy(false)} 
                disabled={deploying} 
                style={{ 
                  background: 'transparent',
                  border: 'none',
                  color: 'white',
                  borderTopLeftRadius: 6, 
                  borderBottomLeftRadius: 6,
                  borderTopRightRadius: 0, 
                  borderBottomRightRadius: 0, 
                  padding: '6px 14px', 
                  fontSize: 13,
                  borderRight: '1px solid rgba(255,255,255,0.15)',
                  cursor: deploying ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                  fontFamily: 'var(--font-sans)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                {deploying ? 'Deploying...' : '🚀 Redeploy'}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setShowDeployDropdown(prev => !prev); }}
                disabled={deploying}
                style={{ 
                  background: 'transparent',
                  border: 'none',
                  color: 'white',
                  borderTopRightRadius: 6, 
                  borderBottomRightRadius: 6,
                  borderTopLeftRadius: 0, 
                  borderBottomLeftRadius: 0, 
                  padding: '6px 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: deploying ? 'not-allowed' : 'pointer'
                }}
              >
                <span style={{ 
                  transform: showDeployDropdown ? 'rotate(180deg)' : 'rotate(0deg)', 
                  transition: 'transform 0.2s',
                  fontSize: 10
                }}>▼</span>
              </button>

              {showDeployDropdown && (
                <div style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  background: '#1e293b',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
                  zIndex: 9999,
                  minWidth: 200,
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  padding: 4
                }}>
                  <button
                    onClick={() => handleDeploy(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#cbd5e1',
                      padding: '8px 12px',
                      fontSize: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      transition: 'background 0.2s, color 0.2s'
                    }}
                    onMouseEnter={(e) => { e.target.style.background = 'rgba(255,255,255,0.05)'; e.target.style.color = '#fff'; }}
                    onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = '#cbd5e1'; }}
                  >
                    <span>🚀</span> Quick Deploy (Cached)
                  </button>
                  <button
                    onClick={() => handleDeploy(true)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#cbd5e1',
                      padding: '8px 12px',
                      fontSize: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      transition: 'background 0.2s, color 0.2s'
                    }}
                    onMouseEnter={(e) => { e.target.style.background = 'rgba(255,255,255,0.05)'; e.target.style.color = '#fff'; }}
                    onMouseLeave={(e) => { e.target.style.background = 'transparent'; e.target.style.color = '#cbd5e1'; }}
                  >
                    <span>⚡</span> Clear Cache & Rebuild
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Project Info Bar */}
      <div className="lp-project-info-bar">
        <div className="lp-project-info-inner">
          <span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 6 }}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
            {project.repoFullName}
          </span>
          <span>Branch: <strong style={{ color: 'var(--text-main)' }}>{project.branch}</strong></span>
          <span>Framework: <strong style={{ color: 'var(--text-main)' }}>{project.framework || 'auto'}</strong></span>
          {deployUrl && <span>URL: <a href={deployUrl} target="_blank" rel="noreferrer" className="lp-info-bar-link">{deployUrl.replace(/^https?:\/\//, '')}</a></span>}
        </div>
      </div>

      <main style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden', width: '100%' }}>
          <div className="lp-detail-layout">

          {/* Left Sidebar */}
          <div className="lp-sidebar-container">
            {SIDEBAR_GROUPS.map((group, idx) => (
              <div key={idx} className="lp-sidebar-group">
                <span className="lp-sidebar-group-label">{group.title}</span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {group.items.map(item => (
                    <div
                      key={item.id}
                      className={`lp-sidebar-link ${activeTab === item.id ? 'active' : ''}`}
                      onClick={() => setActiveTab(item.id)}
                    >
                      <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center', fontSize: '14px', flexShrink: 0 }}>
                        {item.icon}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
                      {renderSidebarBadge(item.id)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Mobile Top Navigation */}
          <div className="lp-mobile-nav-bar">
            {SIDEBAR_GROUPS.flatMap(group => group.items).map(item => (
              <div
                key={item.id}
                className={`lp-mobile-nav-link ${activeTab === item.id ? 'active' : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                <span style={{ fontSize: '14px', flexShrink: 0 }}>{item.icon}</span>
                <span>{item.label}</span>
                {renderSidebarBadge(item.id)}
              </div>
            ))}
          </div>

          {/* Main Content Area */}
          <div className="lp-content-container">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {error && (
            <div className="lp-status-bar error" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>⚠️ {error}</span>
            {error.toLowerCase().includes('in progress') && (
              <button 
                onClick={handleClearStuck} 
                className="lp-btn-secondary" 
                style={{ 
                  marginLeft: 16, 
                  padding: '4px 12px', 
                  fontSize: 12, 
                  background: 'rgba(239, 68, 68, 0.2)', 
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fca5a5',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                ⚡ Force Reset Build State
              </button>
            )}
            <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* ── Deployments ── */}
        {activeTab === 'deployments' && (
          <div className="fade-in" style={{ display: 'grid', gap: 16 }}>
            {/* Container Quick Actions */}
            <div className="lp-card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: project.status === 'live' ? '#10b981' : project.status === 'building' ? '#38bdf8' : '#64748b',
                    boxShadow: project.status === 'live' ? '0 0 8px rgba(16,185,129,0.6)' : project.status === 'building' ? '0 0 8px rgba(56,189,248,0.6)' : 'none',
                    animation: project.status === 'building' ? 'pulse 1.2s ease-in-out infinite' : 'none',
                  }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Container: <span style={{ color: project.status === 'live' ? '#10b981' : project.status === 'building' ? '#38bdf8' : 'var(--text-muted)', textTransform: 'capitalize' }}>{project.status || 'idle'}</span></span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(project.status === 'building' || deploying) && (
                    <button
                      className="lp-btn-secondary"
                      style={{ padding: '6px 14px', fontSize: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}
                      onClick={handleCancelDeploy}
                      disabled={containerAction === 'cancelling'}
                    >
                      {containerAction === 'cancelling' ? '⏳ Cancelling...' : '🛑 Cancel Build'}
                    </button>
                  )}
                  {project.status === 'live' && (
                    <>
                      <button
                        className="lp-btn-secondary"
                        style={{ padding: '6px 14px', fontSize: 12 }}
                        onClick={() => handleContainerAction('restart')}
                        disabled={!!containerAction}
                      >
                        {containerAction === 'restarting' ? '⏳ Restarting...' : '🔄 Restart'}
                      </button>
                      <button
                        className="lp-btn-secondary"
                        style={{ padding: '6px 14px', fontSize: 12, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}
                        onClick={() => handleContainerAction('stop')}
                        disabled={!!containerAction}
                      >
                        {containerAction === 'stopping' ? '⏳ Stopping...' : '⏹ Stop'}
                      </button>
                    </>
                  )}
                  {(project.status === 'stopped' || project.status === 'failed') && project.containerId && (
                    <button
                      className="lp-btn-primary"
                      style={{ padding: '6px 14px', fontSize: 12 }}
                      onClick={() => handleContainerAction('start')}
                      disabled={!!containerAction}
                    >
                      {containerAction === 'starting' ? '⏳ Starting...' : '▶ Start Container'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {deployments?.[0]?.status === 'failed' && renderAiDiagnosis(deployments[0])}

            <div className="lp-card" style={{ padding: 0 }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: 16 }}>Deployment Timeline</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>Production is always the top entry. Click Rollback to revert to a past version.</p>
                </div>
                <button className="lp-btn-secondary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => { handleLoadTrends(); setActiveTab('analytics'); }}>
                  📈 Build Trends
                </button>
              </div>
              {deployments.length === 0 ? (
                <div className="flex-center" style={{ padding: 60, flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 32 }}>🚀</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No deployments yet. Click Redeploy to start.</p>
                </div>
              ) : (
                <div style={{ padding: '8px 0' }}>
                  {deployments.map((dep, i) => {
                    const isProduction = i === 0 && dep.status === 'success';
                    const isRollingBackThis = rollingBack === dep._id;
                    const isActive = dep.status === 'queued' || dep.status === 'building';
                    const dur = formatDuration(dep.duration);
                    return (
                      <div key={dep._id} className="lp-deployment-row" style={{
                        borderBottom: i < deployments.length - 1 ? '1px solid var(--border)' : 'none',
                        background: isProduction ? 'rgba(52,211,153,0.03)' : isActive ? 'rgba(56,189,248,0.02)' : 'transparent',
                        transition: 'background 0.2s',
                      }}>
                        {/* Timeline dot + line */}
                        <div style={{ width: 40, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                          <div style={{
                            width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                            background: dep.status === 'success' ? '#34d399' : dep.status === 'failed' ? '#f87171' : dep.status === 'building' ? '#38bdf8' : '#64748b',
                            boxShadow: dep.status === 'success' ? '0 0 8px rgba(52,211,153,0.5)' : dep.status === 'failed' ? '0 0 8px rgba(248,113,113,0.4)' : dep.status === 'building' ? '0 0 8px rgba(56,189,248,0.5)' : 'none',
                            animation: dep.status === 'building' ? 'pulse 1.2s ease-in-out infinite' : 'none',
                            marginTop: 20,
                            zIndex: 2,
                          }} />
                          {deployments.length > 1 && (
                            <div style={{
                              position: 'absolute',
                              width: 2,
                              left: 19,
                              background: 'var(--border)',
                              zIndex: 1,
                              top: i === 0 ? 26 : 0,
                              bottom: i === deployments.length - 1 ? 'calc(100% - 26px)' : 0,
                            }} />
                          )}
                        </div>

                        {/* Deployment info */}
                        <div style={{ flex: 1, padding: '16px 0 16px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{dep.commitMessage || 'Manual Deploy'}</span>
                            <span className={`lp-badge ${dep.status}`} style={{ fontSize: 11 }}>{dep.status}</span>
                            {isProduction && <span className="lp-badge live" style={{ fontSize: 10 }}>⚡ Production</span>}
                            {dep.isAutoHeal && <span className="lp-badge" style={{ fontSize: 10, background: 'rgba(56,189,248,0.1)', color: 'var(--accent-primary)', border: '1px solid rgba(56,189,248,0.2)' }} title={dep.autoHealFixDescription}>🤖 AI Healed</span>}
                            {dep.rollbackFrom && <span className="lp-badge" style={{ fontSize: 10, background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}>🔄 Rollback</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap', alignItems: 'center' }}>
                            {dep.commitSha && <span style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 4 }}>{dep.commitSha.slice(0, 7)}</span>}
                            {dep.branch && <span>↳ {dep.branch}</span>}
                            {dur && <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>⏱ {dur}</span>}
                            <span>{new Date(dep.createdAt).toLocaleString()}</span>
                            {dep.triggeredBy?.username && <span style={{ color: 'var(--text-muted)' }}>by @{dep.triggeredBy.username}</span>}
                          </div>

                          {/* Release Notes section */}
                          <div style={{ marginTop: 8, fontSize: 13 }}>
                            {editingNotesDepId === dep._id ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                                <textarea
                                  value={tempNotes}
                                  onChange={e => setTempNotes(e.target.value)}
                                  placeholder="Add release notes, updates, or comment for this deployment..."
                                  style={{
                                    width: '100%',
                                    minHeight: 60,
                                    background: 'rgba(255,255,255,0.02)',
                                    border: '1px solid var(--border)',
                                    borderRadius: 6,
                                    padding: '8px 10px',
                                    color: 'var(--text-main)',
                                    fontSize: 12.5,
                                    fontFamily: 'var(--font-sans)',
                                    resize: 'vertical'
                                  }}
                                />
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button
                                    onClick={() => handleSaveNotes(dep._id)}
                                    disabled={notesSaving}
                                    className="lp-btn-primary"
                                    style={{ padding: '4px 10px', fontSize: 11, height: 26 }}
                                  >
                                    {notesSaving ? 'Saving...' : 'Save Notes'}
                                  </button>
                                  <button
                                    onClick={() => { setEditingNotesDepId(null); setTempNotes(''); }}
                                    className="lp-btn-secondary"
                                    style={{ padding: '4px 10px', fontSize: 11, height: 26 }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minHeight: 22 }}>
                                {dep.notes ? (
                                  <span style={{ color: 'var(--text-muted)', fontStyle: 'italic', background: 'rgba(255,255,255,0.02)', padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    📝 {dep.notes}
                                  </span>
                                ) : (
                                  <span style={{ color: 'var(--text-dim)', fontSize: 11.5 }}>No notes added.</span>
                                )}
                                <button
                                  onClick={() => { setEditingNotesDepId(dep._id); setTempNotes(dep.notes || ''); }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--accent-primary)',
                                    fontSize: 11.5,
                                    cursor: 'pointer',
                                    padding: 0,
                                    textDecoration: 'underline'
                                  }}
                                >
                                  {dep.notes ? 'Edit Notes' : 'Add Notes'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="lp-deployment-actions">
                          <button className="lp-btn-secondary" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => viewLogs(dep)}>Logs</button>
                          {!isProduction && dep.status === 'success' && (
                            <button
                              className="lp-btn-secondary"
                              style={{ padding: '5px 12px', fontSize: 12, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: '#fbbf24' }}
                              onClick={() => handleRollback(dep)}
                              disabled={isRollingBackThis || !!rollingBack}
                            >
                              {isRollingBackThis ? '↩ Rolling...' : '↩ Rollback'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Build Logs ── */}
        {activeTab === 'logs' && (
          <div className="fade-in" style={{ display: 'grid', gap: 20 }}>
            <BuildPhaseTimeline deployment={activeDeployment || deployments?.[0]} />
            {activeDeployment && activeDeployment.status === 'failed' && activeDeployment.aiDiagnosis && (
              <div className="lp-card glass" style={{
                padding: '24px',
                borderLeft: '4px solid #ef4444',
                background: 'rgba(239, 68, 68, 0.02)',
                borderRadius: 16,
                border: '1px solid rgba(239, 68, 68, 0.1)',
                borderLeftWidth: 4,
                display: 'grid',
                gap: 16,
                boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 20 }}>🤖</span>
                    <div>
                      <h4 style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-main)', margin: 0, letterSpacing: '0.02em' }}>
                        SRE Build Diagnosis
                      </h4>
                      <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
                        ACTION REQUIRED
                      </div>
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11,
                    background: 'rgba(239, 68, 68, 0.1)',
                    color: '#ef4444',
                    padding: '4px 10px',
                    borderRadius: 20,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    {activeDeployment.aiDiagnosis.summary?.split(':')[0] || 'Build Error'}
                  </span>
                </div>

                <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                    Root Cause
                  </div>
                  <p style={{ color: '#f1f5f9', fontSize: 13, lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
                    {activeDeployment.aiDiagnosis.cause}
                  </p>
                </div>

                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                    Resolution Steps
                  </div>
                  <div style={{
                    background: 'rgba(255,255,255,0.01)',
                    border: '1px solid rgba(255,255,255,0.04)',
                    borderRadius: 12,
                    padding: '16px 20px',
                    fontSize: 13,
                    lineHeight: 1.7,
                    color: '#cbd5e1'
                  }}>
                    {formatMessageContent(activeDeployment.aiDiagnosis.fix)}
                  </div>
                </div>

                {activeDeployment.aiDiagnosis.missingEnvVar && (
                  <div style={{
                    marginTop: '8px',
                    padding: '16px',
                    background: 'rgba(56, 189, 248, 0.03)',
                    border: '1px solid rgba(56, 189, 248, 0.1)',
                    borderRadius: '12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      ⚡ Configure <code style={{ color: 'var(--accent-primary)', fontSize: '13px', background: 'rgba(56, 189, 248, 0.1)', padding: '2px 6px', borderRadius: '4px' }}>{activeDeployment.aiDiagnosis.missingEnvVar}</code> directly:
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <input
                        type="text"
                        value={quickEnvValue}
                        onChange={(e) => setQuickEnvValue(e.target.value)}
                        placeholder={`Enter value for ${activeDeployment.aiDiagnosis.missingEnvVar}`}
                        style={{
                          flex: 1,
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          color: '#fff',
                          fontSize: '13px'
                        }}
                      />
                      <button
                        onClick={handleQuickAddEnv}
                        disabled={quickEnvLoading || !quickEnvValue.trim()}
                        className="lp-btn-primary"
                        style={{
                          padding: '8px 16px',
                          fontSize: '13px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}
                      >
                        {quickEnvLoading ? 'Adding...' : 'Add & Redeploy'}
                      </button>
                    </div>
                  </div>
                )}

                {activeDeployment.aiDiagnosis.commands && activeDeployment.aiDiagnosis.commands.length > 0 && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Copy-Paste Commands
                      </div>
                      <button
                        onClick={() => {
                          const allCmds = activeDeployment.aiDiagnosis.commands.join('\n');
                          navigator.clipboard.writeText(allCmds);
                          const btn = document.getElementById('copy-all-btn');
                          if (btn) {
                            btn.innerText = 'Copied All!';
                            setTimeout(() => { btn.innerText = 'Copy All'; }, 2000);
                          }
                        }}
                        id="copy-all-btn"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--accent-primary)',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          padding: 0
                        }}
                      >
                        Copy All
                      </button>
                    </div>
                    
                    <div style={{ display: 'grid', gap: 8 }}>
                      {activeDeployment.aiDiagnosis.commands.map((cmd, idx) => (
                        <div key={idx} style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          background: '#040406',
                          border: '1px solid rgba(255,255,255,0.03)',
                          borderRadius: 8,
                          padding: '10px 14px',
                          fontFamily: 'var(--font-mono, monospace)',
                          fontSize: 12
                        }}>
                          <span style={{ color: '#38bdf8', overflowX: 'auto', whiteSpace: 'nowrap', marginRight: 16 }}>
                            <span style={{ color: '#64748b', marginRight: 8, userSelect: 'none' }}>$</span>
                            {cmd}
                          </span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(cmd);
                              const btn = document.getElementById(`copy-btn-${idx}`);
                              if (btn) {
                                btn.innerText = 'Copied';
                                setTimeout(() => { btn.innerText = 'Copy'; }, 2000);
                              }
                            }}
                            id={`copy-btn-${idx}`}
                            style={{
                              background: 'rgba(255,255,255,0.03)',
                              border: '1px solid rgba(255,255,255,0.05)',
                              borderRadius: 4,
                              color: 'var(--text-dim)',
                              fontSize: 10,
                              padding: '3px 8px',
                              cursor: 'pointer',
                              fontWeight: 600
                            }}
                          >
                            Copy
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '12px', marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '16px' }}>
                  {logs.some(line => isErrorLine(line)) && (
                    <button
                      onClick={jumpToFirstError}
                      className="lp-btn-primary"
                      style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#f87171'
                      }}
                    >
                      🚨 Jump to Error
                    </button>
                  )}
                  <button
                    onClick={() => handleDeploy(false)}
                    className="lp-btn-primary"
                    style={{
                      padding: '8px 16px',
                      fontSize: '13px',
                      background: 'rgba(255,255,255,0.1)',
                      border: '1px solid rgba(255,255,255,0.15)',
                      color: '#fff'
                    }}
                  >
                    🔄 Retry Build
                  </button>
                  <button
                    onClick={() => handleDeploy(true)}
                    className="lp-btn-secondary"
                    style={{
                      padding: '8px 16px',
                      fontSize: '13px',
                      border: '1px solid rgba(255,255,255,0.1)'
                    }}
                  >
                    🧼 Clean Cache & Rebuild
                  </button>
                </div>
              </div>
            )}

            {activeDeployment && activeDeployment.isAutoHeal && activeDeployment.autoHealDiff && (
              <div className="lp-card glass" style={{ 
                padding: '20px 24px', 
                borderLeft: '4px solid var(--accent-primary)',
                background: 'rgba(56, 189, 248, 0.04)',
                borderRadius: 16
              }}>
                <div className="flex-between">
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      🤖 AI Auto-Healing Active Fix
                    </h4>
                    <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                      {activeDeployment.autoHealFixDescription}
                    </p>
                  </div>
                  <button 
                    className="lp-btn-secondary" 
                    style={{ padding: '6px 14px', fontSize: 11 }}
                    onClick={() => setShowDiff(d => !d)}
                  >
                    {showDiff ? 'Hide Patch Diff' : 'View Code Patch Diff'}
                  </button>
                </div>
                {showDiff && (
                  <pre style={{ 
                    marginTop: 16, 
                    padding: 16, 
                    background: '#090d16', 
                    borderRadius: 12, 
                    border: '1px solid var(--border)',
                    fontFamily: 'var(--font-mono)', 
                    fontSize: 11, 
                    color: '#cbd5e1',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {activeDeployment.autoHealDiff}
                  </pre>
                )}

                {/* ── SRE Auto-Healing Audit Trail Timeline ── */}
                {activeDeployment.autoHealAuditTrail && activeDeployment.autoHealAuditTrail.length > 0 && (
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <div className="lp-section-label" style={{ marginBottom: 12 }}>SRE AUTO-HEALING TIMELINE</div>
                    <div style={{ display: 'grid', gap: 14, position: 'relative', paddingLeft: 16 }}>
                      {/* Vertical line indicator */}
                      <div style={{ 
                        position: 'absolute', 
                        left: 4, 
                        top: 8, 
                        bottom: 8, 
                        width: 2, 
                        background: 'var(--border)' 
                      }} />
                      
                      {activeDeployment.autoHealAuditTrail.map((step, idx) => {
                        const statusColors = {
                          success: '#34d399',
                          failure: '#f87171',
                          info: '#818cf8'
                        };
                        const color = statusColors[step.status] || 'var(--text-dim)';
                        
                        return (
                          <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', position: 'relative' }}>
                            {/* Dot indicator */}
                            <div style={{ 
                              position: 'absolute',
                              left: -20,
                              top: 5,
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              background: color,
                              border: '2px solid var(--bg-main)',
                              boxShadow: `0 0 8px ${color}`
                            }} />
                            
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-main)' }}>{step.step}</span>
                                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                                  {new Date(step.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                              </div>
                              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{step.details}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            {deploying && (deployments?.[0] || activeDeployment) && (
              <BuildCountdownTimer 
                startedAt={(deployments?.[0] || activeDeployment)?.startedAt || (deployments?.[0] || activeDeployment)?.createdAt}
                estimatedDuration={(deployments?.[0] || activeDeployment)?.estimatedDuration}
              />
            )}
            <div className="lp-terminal">
              <div className="lp-terminal-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', gap: '12px', minHeight: '44px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div className="lp-terminal-dots">
                    <div className="lp-terminal-dot" style={{ background: '#ff5f57' }} />
                    <div className="lp-terminal-dot" style={{ background: '#ffbd2e' }} />
                    <div className="lp-terminal-dot" style={{ background: '#28c840' }} />
                  </div>
                  <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-main)' }}>Build Output — {project.name}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginLeft: 'auto', flexWrap: 'wrap' }}>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <span style={{ position: 'absolute', left: '8px', fontSize: '11px', opacity: 0.5 }}>🔍</span>
                    <input
                      type="text"
                      placeholder="Search logs..."
                      value={logSearchQuery}
                      onChange={(e) => setLogSearchQuery(e.target.value)}
                      style={{
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '6px',
                        padding: '4px 8px 4px 24px',
                        fontSize: '11px',
                        color: '#fff',
                        width: '130px',
                        outline: 'none',
                        transition: 'all 0.2s ease'
                      }}
                      onFocus={(e) => { e.target.style.width = '180px'; e.target.style.borderColor = 'rgba(56, 189, 248, 0.4)'; }}
                      onBlur={(e) => { e.target.style.width = '130px'; e.target.style.borderColor = 'rgba(255, 255, 255, 0.08)'; }}
                    />
                    {logSearchQuery && (
                      <button
                        onClick={() => setLogSearchQuery('')}
                        style={{
                          position: 'absolute',
                          right: '6px',
                          background: 'none',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          fontSize: '10px',
                          padding: 0
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={showErrorsOnly}
                      onChange={(e) => setShowErrorsOnly(e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: '#ef4444' }}
                    />
                    <span>Errors Only</span>
                  </label>

                  <button
                    onClick={() => {
                      const text = filteredLogsWithIndex.map(x => x.line).join('\n');
                      navigator.clipboard.writeText(text);
                      const btn = document.getElementById('copy-terminal-logs-btn');
                      if (btn) {
                        btn.innerText = 'Copied!';
                        setTimeout(() => { btn.innerText = 'Copy Logs'; }, 2000);
                      }
                    }}
                    id="copy-terminal-logs-btn"
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '6px',
                      color: 'var(--text-main)',
                      fontSize: '11px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => { e.target.style.background = 'rgba(255, 255, 255, 0.08)'; }}
                    onMouseLeave={(e) => { e.target.style.background = 'rgba(255, 255, 255, 0.04)'; }}
                  >
                    📋 Copy Logs
                  </button>

                  {deploying && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-primary)', fontSize: '11px', fontWeight: 600 }}>
                      <span className="loading-spinner" style={{ width: 8, height: 8, border: '2px solid rgba(56,189,248,0.2)', borderTopColor: 'var(--accent-primary)' }} />
                      <span>Live</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="lp-terminal-body">
                {filteredLogsWithIndex.length === 0 ? (
                  <span style={{ opacity: 0.4 }}>No matching logs found.</span>
                ) : filteredLogsWithIndex.map(({ line, index }) => (
                  <div key={index} id={`log-line-${index}`} style={{ display: 'block' }}>
                    <LogLine line={line} />
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* ── Runtime Logs ── */}
        {activeTab === 'runtime-logs' && (
          <div className="lp-terminal fade-in">
            <div className="lp-terminal-header" style={{ position: 'relative' }}>
              <div className="lp-terminal-dots">
                <div className="lp-terminal-dot" style={{ background: '#ff5f57' }} />
                <div className="lp-terminal-dot" style={{ background: '#ffbd2e' }} />
                <div className="lp-terminal-dot" style={{ background: '#28c840' }} />
              </div>
              <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>Container stdout/stderr — {project.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', marginLeft: 'auto' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', animation: 'pulse-dot 2s infinite' }}></div>
                Live Stream
              </div>
            </div>
            <div className="lp-terminal-body" style={{ maxHeight: '500px', overflowY: 'auto' }}>
              {runtimeLogs.length === 0 ? (
                <span style={{ opacity: 0.4 }}>Waiting for runtime log stream...</span>
              ) : runtimeLogs.map((line, i) => (
                <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#e2e8f0', lineHeight: 1.5 }}>{line}</div>
              ))}
              <div ref={runtimeLogsEndRef} />
            </div>
          </div>
        )}

        {/* ── Environment Variables ── */}
        {activeTab === 'env' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {envChanged && (
              <div className="glass fade-in" style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid rgba(56,189,248,0.35)', background: 'rgba(56,189,248,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <span style={{ fontSize: 13, color: '#38bdf8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>💡</span> Environment variables have changed. Redeploy your project to apply the new values to the live container.
                </span>
                <button 
                  onClick={() => { handleDeploy(false); setEnvChanged(false); }}
                  className="lp-btn-primary"
                  style={{ padding: '6px 16px', fontSize: 12, fontWeight: 700 }}
                >
                  🚀 Redeploy Now
                </button>
              </div>
            )}
            <div className="lp-card" style={{ padding: 24 }}>
              <div className="flex-between" style={{ marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontSize: 16, marginBottom: 4 }}>Environment Variables</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Encrypted secrets injected at build and runtime.</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="lp-btn-secondary" style={{ padding: '7px 14px', fontSize: 13, background: 'linear-gradient(135deg, rgba(168,85,247,0.1) 0%, rgba(129,140,248,0.1) 100%)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc' }} onClick={handleAiScanMissingVars} disabled={missingVarsLoading}>
                    {missingVarsLoading ? 'Scanning...' : '🔮 Scan Missing Keys'}
                  </button>
                  <button className="lp-btn-secondary" style={{ padding: '7px 14px', fontSize: 13, background: 'linear-gradient(135deg, rgba(56,189,248,0.1) 0%, rgba(59,130,246,0.1) 100%)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8' }} onClick={handleAiAutoDetect} disabled={aiScanning}>
                    {aiScanning ? 'Scanning...' : '🔍 AI Auto-Detect'}
                  </button>
                  <button className="lp-btn-secondary" style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => { setShowBulk(!showBulk); if(showHistory) setShowHistory(false); }}>
                    {showBulk ? 'Manual' : '📋 Bulk Import'}
                  </button>
                  <button className="lp-btn-secondary" style={{ padding: '7px 14px', fontSize: 13, background: showHistory ? 'rgba(56,189,248,0.1)' : 'none', border: showHistory ? '1px solid var(--accent-primary)' : '1px solid var(--border)', color: showHistory ? 'var(--accent-primary)' : 'var(--text-main)' }} onClick={handleLoadEnvHistory}>
                    {showHistory ? '✕ Close History' : '📜 View Audit Log'}
                  </button>
                </div>
              </div>

              {envVars.some(e => e.hasPlaceholder && requiresUserInput(e.key)) && (
                <div className="glass fade-in" style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid rgba(239, 68, 68, 0.35)', background: 'rgba(239, 68, 68, 0.03)', marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fca5a5', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>⚠️</span> DEPLOYMENT BLOCKED: Please configure the required environment variables marked below to resume deployment.
                  </div>
                </div>
              )}

              {/* Security Warnings */}
              {envWarnings && envWarnings.length > 0 && (
                <div className="glass fade-in" style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid rgba(239, 68, 68, 0.35)', background: 'rgba(239, 68, 68, 0.03)', marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <span>⚠️</span> CRITICAL SECURITY AUDIT WARNINGS (Secrets Exposed):
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {envWarnings.map((w, idx) => (
                      <div key={idx} style={{ fontSize: 12, color: '#f87171', background: 'rgba(239, 68, 68, 0.08)', padding: '8px 12px', borderRadius: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>
                          <strong>{w.type}</strong> found in <code>{w.file}</code> (Value: <code>{w.leakedValue}</code>)
                        </span>
                        <span style={{ fontSize: 10, background: 'rgba(239, 68, 68, 0.2)', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>EXPOSED</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Variable Collisions */}
              {envCollisions && envCollisions.length > 0 && (
                <div className="glass fade-in" style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid rgba(245, 158, 11, 0.35)', background: 'rgba(245, 158, 11, 0.03)', marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <span>⚡</span> VARIABLE REDUNDANCIES / COLLISIONS DETECTED:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {envCollisions.map((c, idx) => (
                      <div key={idx} style={{ fontSize: 12, color: '#fbbf24', background: 'rgba(245, 158, 11, 0.08)', padding: '8px 12px', borderRadius: 6 }}>
                        <strong>{c.type}</strong>: {c.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestion Chips */}
              {missingVars && missingVars.length > 0 && (
                <div className="glass fade-in" style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid rgba(192, 132, 252, 0.25)', background: 'rgba(168, 85, 247, 0.02)', marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#c084fc', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <span>💡</span> Referenced Keys Missing from Vault (Click to add):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {missingVars.map(v => (
                      <button
                        key={v}
                        onClick={() => handleAddMissingVarDirect(v)}
                        disabled={addingMissingVar === v}
                        style={{
                          background: 'rgba(168, 85, 247, 0.1)',
                          border: '1px solid rgba(168, 85, 247, 0.25)',
                          color: '#c084fc',
                          padding: '6px 12px',
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          borderStyle: 'solid'
                        }}
                      >
                        {addingMissingVar === v ? 'Adding...' : `+ ${v}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Add single */}
              {!showBulk && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24, padding: 16, background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 12 }}>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input value={envKey} onChange={e => setEnvKey(e.target.value.toUpperCase())} placeholder="VARIABLE_NAME" className="lp-input lp-input-mono" style={{ flex: 1 }} />
                    <input value={envValue} onChange={e => setEnvValue(e.target.value)} placeholder="value" type={envKey.includes('SECRET') || envKey.includes('KEY') || envKey.includes('PASSWORD') || envKey.includes('TOKEN') ? 'password' : 'text'} className="lp-input" style={{ flex: 2 }} />
                    <button className="lp-btn-primary" onClick={handleAddEnv} style={{ flexShrink: 0, height: 38 }}>Add</button>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingLeft: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Apply Scopes:</span>
                    {['production', 'preview', 'development'].map(scope => (
                      <label key={scope} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-main)', cursor: 'pointer', textTransform: 'capitalize' }}>
                        <input
                          type="checkbox"
                          checked={envScopes.includes(scope)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setEnvScopes(prev => [...prev, scope]);
                            } else {
                              setEnvScopes(prev => prev.filter(s => s !== scope));
                            }
                          }}
                          style={{ cursor: 'pointer' }}
                        />
                        <span>{scope}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Bulk import */}
              {showBulk && (
                <div style={{ marginBottom: 24 }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>Paste your .env file content below:</p>
                  <textarea
                    value={bulkEnv}
                    onChange={e => setBulkEnv(e.target.value)}
                    placeholder={`DATABASE_URL=mongodb://...\nAPI_KEY=secret123\nNODE_ENV=production`}
                    className="lp-input"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12, height: 140 }}
                  />
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <button className="lp-btn-primary" onClick={handleBulkImport} disabled={bulkImporting}>
                      {bulkImporting ? 'Importing...' : 'Import All'}
                    </button>
                    <button className="lp-btn-secondary" onClick={() => { setShowBulk(false); setBulkEnv(''); }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Env var history log */}
              {showHistory && (
                <div style={{ marginBottom: 24, padding: 16, background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 12 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-main)' }}>
                    <span>📜</span> Environment Variable Audit Log & Rollback
                  </h4>
                  {historyLoading ? (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-muted)', fontSize: 13, padding: 12 }}>
                      <div className="loading-spinner" style={{ width: 14, height: 14 }} /> Loading audit logs...
                    </div>
                  ) : envHistory.length === 0 ? (
                    <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 13 }}>No version history recorded yet.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto', paddingRight: 6 }}>
                      {envHistory.map((h) => {
                        const dateStr = new Date(h.timestamp).toLocaleString();
                        const actionColor = h.action === 'delete' ? 'var(--accent-danger)' : h.action === 'create' ? 'var(--accent-success)' : 'var(--accent-primary)';
                        return (
                          <div key={h._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.15)', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.02)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12.5, color: 'var(--text-main)' }}>{h.key}</span>
                                <span style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.05)', color: actionColor, textTransform: 'uppercase' }}>
                                  {h.action}
                                </span>
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {dateStr} • by <span style={{ color: 'var(--text-dim)' }}>{h.user?.name || h.user?.email || 'System'}</span>
                              </div>
                            </div>
                            <button
                              onClick={() => handleRestoreEnvHistory(h._id)}
                              className="lp-btn-secondary"
                              style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: '1px solid rgba(255,255,255,0.08)' }}
                            >
                              ⏪ Restore
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Env list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {envVars.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>No environment variables set</div>
                ) : envVars.map(e => (
                  <div key={e._id} className="lp-env-row">
                    <span className="mono" style={{ color: 'var(--accent-primary)', fontWeight: 700, fontSize: 13, flex: 1, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {e.key}
                      
                      {e.scopes && e.scopes.map(s => (
                        <span key={s} style={{
                          fontSize: 9,
                          background: 'rgba(56, 189, 248, 0.05)',
                          border: '1px solid rgba(56, 189, 248, 0.15)',
                          color: '#38bdf8',
                          padding: '1px 5px',
                          borderRadius: 3,
                          textTransform: 'capitalize',
                          fontWeight: 600
                        }}>
                          {s}
                        </span>
                      ))}

                      {e.hasPlaceholder && (
                        <span style={{
                          fontSize: 10,
                          background: requiresUserInput(e.key) ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                          border: requiresUserInput(e.key) ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid rgba(245, 158, 11, 0.3)',
                          color: requiresUserInput(e.key) ? '#fca5a5' : '#fde047',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontWeight: 600
                        }}>
                          {requiresUserInput(e.key) ? '⚠️ Required — Missing Value' : '⚠️ Placeholder / Provisioning'}
                        </span>
                      )}
                    </span>
                    <span style={{ flex: 2, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)', letterSpacing: showVal[e._id] ? 0 : 4 }}>
                      {showVal[e._id] ? (decryptedVals[e._id] || '') : '••••••••••••'}
                    </span>
                    <button onClick={() => handleShowClick(e.key, e._id)} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, marginRight: 8 }}>
                      {showVal[e._id] ? 'Hide' : 'Show'}
                    </button>
                    <button onClick={() => handleEditClick(e.key)} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: 12, fontWeight: 600, marginRight: 8 }}>Edit</button>
                    <button onClick={() => handleDeleteEnv(e.key)} style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Settings ── */}
        {activeTab === 'settings' && (
          <div className="fade-in" style={{ display: 'grid', gap: 20, maxWidth: 700 }}>
            <div className="lp-card" style={{ padding: 28 }}>
              <h3 style={{ fontSize: 16, marginBottom: 6 }}>Build Configuration</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>Override the default install/build commands for this project.</p>

              <div style={{ display: 'grid', gap: 20 }}>
                {[
                  { label: 'BRANCH', key: 'branch', placeholder: 'main' },
                  { label: 'INSTALL COMMAND', key: 'installCommand', placeholder: 'npm install', mono: true },
                  { label: 'BUILD COMMAND',   key: 'buildCommand',   placeholder: 'npm run build', mono: true },
                  { label: 'OUTPUT DIRECTORY',key: 'outputDir',      placeholder: 'dist', mono: true },
                  { label: 'HEALTH CHECK PATH', key: 'healthCheckPath', placeholder: '/api/health', mono: true },
                  { label: 'PERSISTENT MOUNT PATH (VOLUME BIND)', key: 'persistentPath', placeholder: '/app/data', mono: true },
                ].map(({ label, key, placeholder, mono }) => (
                  <div key={key}>
                    <div className="lp-section-label">{label}</div>
                    {key === 'branch' && branches.length > 0 ? (
                      <select
                        value={settings.branch}
                        onChange={e => setSettings(s => ({ ...s, branch: e.target.value }))}
                        className="lp-input"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                      >
                        {branches.map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={settings[key]}
                        onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className={`lp-input${mono ? ' lp-input-mono' : ''}`}
                      />
                    )}
                  </div>
                ))}

                <div className="flex-between" style={{ paddingTop: 8 }}>
                  {saveStatus === 'saved' && <div className="lp-status-bar success" style={{ padding: '6px 14px', fontSize: 12 }}>✓ Settings saved</div>}
                  {saveStatus === 'error' && <div className="lp-status-bar error" style={{ padding: '6px 14px', fontSize: 12 }}>Failed to save</div>}
                  {saveStatus && saveStatus !== 'saved' && saveStatus !== 'error' && saveStatus !== 'saving' && (
                    <div className="lp-status-bar success" style={{ padding: '6px 14px', fontSize: 12 }}>{saveStatus}</div>
                  )}
                  {!saveStatus && <div />}
                  <button className="lp-btn-primary" onClick={handleSaveSettings} disabled={saveStatus === 'saving'}>
                    {saveStatus === 'saving' ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>

            <div className="lp-card glass" style={{ 
              padding: 28,
              borderLeft: '4px solid var(--accent-secondary)',
              background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.05) 0%, rgba(56, 189, 248, 0.02) 100%)'
            }}>
              <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                ⚡ SRE Zero-Downtime Container Scaling
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
                Scale container capacity boundaries on-the-fly. This triggers an automated hot-swap rebuild with zero service downtime.
              </p>

              <div style={{ display: 'grid', gap: 24 }}>
                <div>
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <div className="lp-section-label" style={{ margin: 0 }}>CPU ALLOCATION</div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-secondary)' }}>
                      {cpuLimit} Cores
                    </span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="2.0" 
                    step="0.1"
                    value={cpuLimit} 
                    onChange={e => setCpuLimit(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--accent-secondary)' }}
                  />
                  <div className="flex-between" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                    <span>0.1 Cores (Micro)</span>
                    <span>1.0 Cores (Standard)</span>
                    <span>2.0 Cores (Production)</span>
                  </div>
                </div>

                <div>
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <div className="lp-section-label" style={{ margin: 0 }}>RAM ALLOCATION</div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-secondary)' }}>
                      {ramLimitMB} MB
                    </span>
                  </div>
                  <input 
                    type="range" 
                    min="128" 
                    max="1024" 
                    step="128"
                    value={ramLimitMB} 
                    onChange={e => setRamLimitMB(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--accent-secondary)' }}
                  />
                  <div className="flex-between" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                    <span>128 MB</span>
                    <span>512 MB</span>
                    <span>1024 MB</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
                  <button 
                    className="lp-btn-primary" 
                    onClick={handleResizeLimits} 
                    disabled={resizing}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 8, 
                      padding: '12px 24px',
                      background: 'var(--accent-secondary)',
                      boxShadow: '0 0 20px rgba(129, 140, 248, 0.2)'
                    }}
                  >
                    {resizing ? (
                      <>
                        <div className="loading-spinner" style={{ width: 16, height: 16, borderColor: '#fff', borderTopColor: 'transparent' }} />
                        Executing Hot-Swap...
                      </>
                    ) : (
                      <>⚡ Apply SRE Resize Limits</>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="lp-card glass" style={{ 
              padding: 28,
              borderLeft: '4px solid var(--accent-primary)',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.05) 0%, rgba(129, 140, 248, 0.02) 100%)'
            }}>
              <h3 style={{ fontSize: 16, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                🤖 AI Auto-Healing & Self-Correction
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
                When enabled, LaunchLive AI automatically intercepts deployment/health check failures, analyzes the logs, patches your code files locally, and re-runs the build.
              </p>

              <div style={{ display: 'grid', gap: 20 }}>
                <div className="flex-between">
                  <div className="lp-section-label" style={{ margin: 0 }}>ENABLE AI AUTO-HEALING</div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={settings.autoHeal} 
                      onChange={e => setSettings(s => ({ ...s, autoHeal: e.target.checked }))}
                      style={{ width: 40, height: 20, accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                    />
                  </label>
                </div>

                {settings.autoHeal && (
                  <div className="fade-in" style={{ display: 'grid', gap: 8 }}>
                    <div className="lp-section-label" style={{ margin: 0 }}>COMMIT & PUSH STRATEGY</div>
                    <select
                      value={settings.autoHealStrategy}
                      onChange={e => setSettings(s => ({ ...s, autoHealStrategy: e.target.value }))}
                      className="lp-input"
                      style={{ background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                    >
                      <option value="push-on-success">Push on Success (Recommended)</option>
                      <option value="pr">Create Pull Request (PR)</option>
                      <option value="local-only">Local Patch Only (Do not push to GitHub)</option>
                    </select>
                    <p style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 4 }}>
                      {settings.autoHealStrategy === 'push-on-success' && 'AI will verify the fix first, and only push back to GitHub once the build is 100% healthy.'}
                      {settings.autoHealStrategy === 'pr' && 'AI will verify the fix, push to a new branch, and open a GitHub Pull Request.'}
                      {settings.autoHealStrategy === 'local-only' && 'AI patches the local container to make it live, but leaves GitHub untouched.'}
                    </p>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
                  <button className="lp-btn-primary" onClick={handleSaveSettings} disabled={saveStatus === 'saving'}>
                    {saveStatus === 'saving' ? 'Saving Auto-Heal Settings...' : 'Save Auto-Heal Configuration'}
                  </button>
                </div>
              </div>
            </div>

            {/* Deploy Hooks (Incoming Webhooks) */}
            <div className="lp-card glass" style={{ padding: 28 }}>
              <h3 style={{ fontSize: 16, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                📥 Incoming Deploy Hooks
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                Trigger automatic redeployments of specific branches by sending an HTTP POST request to these unique URLs.
              </p>

              {/* Create Deploy Hook Form */}
              <div style={{ display: 'grid', gap: 14, marginBottom: 24, padding: 20, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-main)' }}>Create Deploy Hook</div>
                <div className="lp-form-row" style={{ gap: 12 }}>
                  <div>
                    <div className="lp-section-label" style={{ marginBottom: 6 }}>HOOK NAME</div>
                    <input
                      type="text"
                      placeholder="e.g. Production Deploy"
                      value={newHookName}
                      onChange={e => setNewHookName(e.target.value)}
                      className="lp-input"
                    />
                  </div>
                  <div>
                    <div className="lp-section-label" style={{ marginBottom: 6 }}>TARGET BRANCH</div>
                    <select
                      value={newHookBranch}
                      onChange={e => setNewHookBranch(e.target.value)}
                      className="lp-input"
                      style={{ background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                    >
                      {branches.length > 0 ? (
                        branches.map(b => <option key={b} value={b}>{b}</option>)
                      ) : (
                        <option value="main">main</option>
                      )}
                    </select>
                  </div>
                  <button 
                    className="lp-btn-primary" 
                    onClick={handleCreateDeployHook}
                    disabled={!newHookName.trim()}
                    style={{ height: '42px', padding: '0 20px' }}
                  >
                    Create
                  </button>
                </div>
              </div>

              {/* List of Deploy Hooks */}
              <div style={{ display: 'grid', gap: 12 }}>
                {deployHooks.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
                    No deploy hooks configured yet.
                  </div>
                ) : (
                  deployHooks.map(hook => {
                    const hookUrl = `${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'}/api/deploy/hooks/${hook.token}`;
                    return (
                      <div key={hook._id} style={{ display: 'grid', gap: 8, padding: 14, background: 'rgba(255, 255, 255, 0.01)', border: '1px solid var(--border)', borderRadius: 10 }}>
                        <div className="flex-between">
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-main)' }}>
                            {hook.name} <span style={{ fontSize: 11, color: 'var(--accent-secondary)', fontWeight: 500, marginLeft: 8 }}>({hook.branch})</span>
                          </span>
                          <button 
                            onClick={() => handleDeleteDeployHook(hook._id)}
                            style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', fontSize: 12, cursor: 'pointer', padding: 0 }}
                          >
                            ✕ Delete
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input
                            readOnly
                            value={hookUrl}
                            className="lp-input lp-input-mono"
                            style={{ flex: 1, fontSize: 11, padding: '6px 10px', height: '32px', cursor: 'text' }}
                            onFocus={e => e.target.select()}
                          />
                          <button
                            className="lp-btn-secondary"
                            style={{ padding: '0 12px', fontSize: 11, height: '32px' }}
                            onClick={() => {
                              navigator.clipboard.writeText(hookUrl);
                              alert('Deploy Hook URL copied to clipboard!');
                            }}
                          >
                            📋 Copy
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Outgoing Webhooks Notifications */}
            <div className="lp-card glass" style={{ padding: 28 }}>
              <h3 style={{ fontSize: 16, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                🔔 Outgoing Build Notifications
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                Send real-time build updates and AI resolution diagnostics to your Slack or Discord channels.
              </p>

              {/* Create Outgoing Webhook Form */}
              <div style={{ display: 'grid', gap: 14, marginBottom: 24, padding: 20, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-main)' }}>Add Webhook Alert</div>
                <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 12 }}>
                    <div>
                      <div className="lp-section-label" style={{ marginBottom: 6 }}>PLATFORM</div>
                      <select
                        value={newHookType}
                        onChange={e => setNewHookType(e.target.value)}
                        className="lp-input"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                      >
                        <option value="slack">Slack</option>
                        <option value="discord">Discord</option>
                      </select>
                    </div>
                    <div>
                      <div className="lp-section-label" style={{ marginBottom: 6 }}>WEBHOOK URL</div>
                      <input
                        type="text"
                        placeholder="https://hooks.slack.com/services/... or Discord Webhook URL"
                        value={newHookUrl}
                        onChange={e => setNewHookUrl(e.target.value)}
                        className="lp-input lp-input-mono"
                        style={{ fontSize: 12 }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="lp-section-label" style={{ marginBottom: 8 }}>TRIGGER EVENTS</div>
                    <div style={{ display: 'flex', gap: 20 }}>
                      {[
                        { key: 'start', label: 'Build Started' },
                        { key: 'success', label: 'Build Success' },
                        { key: 'failure', label: 'Build Failure' }
                      ].map(event => {
                        const isChecked = newHookEvents.includes(event.key);
                        return (
                          <label key={event.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', userSelect: 'none' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              style={{ accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                              onChange={e => {
                                if (e.target.checked) {
                                  setNewHookEvents([...newHookEvents, event.key]);
                                } else {
                                  setNewHookEvents(newHookEvents.filter(x => x !== event.key));
                                }
                              }}
                            />
                            <span>{event.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                    <button 
                      className="lp-btn-primary" 
                      onClick={handleCreateOutgoingWebhook}
                      disabled={!newHookUrl.trim() || newHookEvents.length === 0}
                    >
                      Add Webhook
                    </button>
                  </div>
                </div>
              </div>

              {/* List of Outgoing Webhooks */}
              <div style={{ display: 'grid', gap: 12 }}>
                {outgoingWebhooks.length === 0 ? (
                  <div style={{ color: 'var(--text-dim)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
                    No webhook alerts configured yet.
                  </div>
                ) : (
                  outgoingWebhooks.map(webhook => (
                    <div key={webhook._id} className="flex-between" style={{ padding: 14, background: 'rgba(255, 255, 255, 0.01)', border: '1px solid var(--border)', borderRadius: 10 }}>
                      <div style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16 }}>{webhook.type === 'slack' ? '💬' : '👾'}</span>
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-main)' }}>{webhook.name}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '350px', whiteSpace: 'nowrap' }}>
                          {webhook.url}
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                          {webhook.events.map(ev => (
                            <span key={ev} style={{ fontSize: 10, background: 'rgba(255, 255, 255, 0.04)', color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 4, textTransform: 'capitalize' }}>
                              {ev}
                            </span>
                          ))}
                        </div>
                      </div>
                      <button 
                        onClick={() => handleDeleteOutgoingWebhook(webhook._id)}
                        style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', fontSize: 12, cursor: 'pointer', padding: 0 }}
                      >
                        ✕ Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* README Status Badge */}
            <div className="lp-card glass" style={{ padding: 28 }}>
              <h3 style={{ fontSize: 16, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                🛡️ SVG README Status Badge
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                Display the real-time deployment status of your project directly in your GitHub README.md or documentation.
              </p>

              <div style={{ display: 'grid', gap: 16, padding: 20, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 12, border: '1px solid var(--border)' }}>
                <div>
                  <div className="lp-section-label" style={{ marginBottom: 8 }}>LIVE BADGE PREVIEW</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                    <img 
                      src={`${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'}/api/deploy/projects/${id}/badge?t=${badgeTimestamp}`}
                      alt="Deployment Status" 
                      style={{ maxHeight: 20 }}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = "https://img.shields.io/badge/LaunchLive-unknown-grey";
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="lp-section-label" style={{ marginBottom: 6 }}>MARKDOWN SOURCE</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      readOnly
                      value={`[![Deployment Status](${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'}/api/deploy/projects/${id}/badge)](${window.location.origin}/projects/${id})`}
                      className="lp-input lp-input-mono"
                      style={{ flex: 1, fontSize: 11, cursor: 'text' }}
                      onFocus={e => e.target.select()}
                    />
                    <button
                      className="lp-btn-secondary"
                      style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12 }}
                      onClick={() => {
                        const md = `[![Deployment Status](${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'}/api/deploy/projects/${id}/badge)](${window.location.origin}/projects/${id})`;
                        navigator.clipboard.writeText(md);
                        alert('Markdown status badge copied!');
                      }}
                    >
                      📋 Copy Markdown
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 🌍 Multi-Region Edge Replication Card */}
            <div className="lp-card glass" style={{ 
              padding: 28, 
              borderLeft: '4px solid #10b981',
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.05) 0%, rgba(56, 189, 248, 0.02) 100%)'
            }}>
              <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                🌍 Multi-Region Edge Replication
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
                Deploy instances of your application closer to your users across secondary locations to reduce round-trip network latency.
              </p>

              <div style={{ display: 'grid', gap: 24 }}>
                <div>
                  <div className="lp-section-label" style={{ marginBottom: 12 }}>SELECT TARGET REGIONS</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 14 }}>
                    {[
                      { key: 'us-ashburn-1', label: 'US East (Ashburn)', ping: '240ms' },
                      { key: 'uk-london-1',  label: 'Europe (London)',   ping: '124ms' },
                      { key: 'ap-mumbai-1',  label: 'Asia (Mumbai)',     ping: '22ms' },
                    ].map(regionOption => {
                      const isSelected = regions.includes(regionOption.key);
                      return (
                        <label 
                          key={regionOption.key} 
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 12, 
                            padding: 14, 
                            borderRadius: 8, 
                            border: `1px solid ${isSelected ? '#10b981' : 'var(--border)'}`, 
                            background: isSelected ? 'rgba(16, 185, 129, 0.05)' : 'rgba(255,255,255,0.01)',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          <input 
                            type="checkbox"
                            checked={isSelected}
                            disabled={regionsSaving || regionOption.key === 'us-ashburn-1'} // Primary region is required
                            onChange={() => {
                              let nextRegions;
                              if (isSelected) {
                                nextRegions = regions.filter(r => r !== regionOption.key);
                              } else {
                                nextRegions = [...regions, regionOption.key];
                              }
                              handleSaveRegions(nextRegions);
                            }}
                            style={{ accentColor: '#10b981', cursor: 'pointer' }}
                          />
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)' }}>{regionOption.label}</div>
                            <div style={{ fontSize: 11, color: isSelected ? '#10b981' : 'var(--text-dim)', marginTop: 2 }}>
                              Ping: {regionOption.ping}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Latency Map Visualization */}
                <div style={{ 
                  padding: 20, 
                  background: 'rgba(0,0,0,0.2)', 
                  border: '1px solid var(--border)', 
                  borderRadius: 10,
                  display: 'grid',
                  gap: 14
                }}>
                  <div className="flex-between">
                    <div className="lp-section-label" style={{ margin: 0 }}>LIVE ROUTING LATENCY MAP</div>
                    <span style={{ fontSize: 11.5, color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="live-pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                      Optimal route active
                    </span>
                  </div>

                  {/* SVG Map Graphic */}
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
                    <svg viewBox="0 0 400 160" style={{ width: '100%', maxWidth: '380px', height: 'auto' }}>
                      {/* World map stylized continents path */}
                      <path d="M50,40 Q60,30 90,30 T120,40 T160,50 T180,70 T150,90 T120,110 T80,100 T50,80 Z M250,50 Q280,30 310,40 T350,60 T380,90 T340,110 T300,120 T260,90 Z" fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
                      
                      {/* Connections */}
                      {regions.includes('uk-london-1') && (
                        <line x1="100" y1="50" x2="220" y2="45" stroke="#10b981" strokeWidth="1.5" strokeDasharray="4 4" />
                      )}
                      {regions.includes('ap-mumbai-1') && (
                        <line x1="100" y1="50" x2="300" y2="90" stroke="#10b981" strokeWidth="1.5" strokeDasharray="4 4" />
                      )}

                      {/* Nodes */}
                      {/* Primary US East */}
                      <circle cx="100" cy="50" r="5" fill="#38bdf8" />
                      <circle cx="100" cy="50" r="10" fill="none" stroke="#38bdf8" strokeWidth="1" className="ping-ring" />
                      <text x="100" y="38" fill="#fff" fontSize="9" textAnchor="middle" fontWeight="bold">US EAST (Host)</text>

                      {/* London */}
                      {regions.includes('uk-london-1') && (
                        <>
                          <circle cx="220" cy="45" r="5" fill="#10b981" />
                          <text x="220" y="33" fill="#10b981" fontSize="9" textAnchor="middle">UK Edge</text>
                        </>
                      )}

                      {/* Mumbai */}
                      {regions.includes('ap-mumbai-1') && (
                        <>
                          <circle cx="300" cy="90" r="5" fill="#10b981" />
                          <text x="300" y="105" fill="#10b981" fontSize="9" textAnchor="middle">India Edge</text>
                        </>
                      )}
                    </svg>
                  </div>
                </div>

                {regionsMessage && (
                  <div className="lp-status-bar success" style={{ fontSize: 12.5, padding: '10px 14px' }}>
                    {regionsMessage}
                  </div>
                )}
              </div>
            </div>

            {/* ⏱️ Scheduled Deployments (Cron) Card */}
            <div className="lp-card glass" style={{ padding: 28 }}>
              <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                ⏱️ Scheduled Deployments (Cron)
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                Automatically trigger periodic rebuilds and redeployments of your project using cron schedule expressions.
              </p>

              <div style={{ display: 'grid', gap: 20 }}>
                <div className="flex-between">
                  <div className="lp-section-label" style={{ margin: 0 }}>ENABLE CRON SCHEDULES</div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={cronEnabled} 
                      onChange={e => {
                        setCronEnabled(e.target.checked);
                        handleSaveCron(e.target.checked, cronSchedule);
                      }}
                      style={{ width: 40, height: 20, accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
                    />
                  </label>
                </div>

                {cronEnabled && (
                  <div className="fade-in" style={{ display: 'grid', gap: 14, padding: 18, background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div>
                      <div className="lp-section-label" style={{ marginBottom: 8 }}>CRON EXPRESSION</div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <input
                          type="text"
                          placeholder="e.g. 0 0 * * * (Every midnight)"
                          value={cronSchedule}
                          onChange={e => setCronSchedule(e.target.value)}
                          className="lp-input lp-input-mono"
                          style={{ flex: 1 }}
                        />
                        <button 
                          className="lp-btn-primary" 
                          onClick={() => handleSaveCron(cronEnabled, cronSchedule)}
                          disabled={cronSaving}
                          style={{ padding: '0 20px', height: 42 }}
                        >
                          {cronSaving ? 'Saving...' : 'Apply'}
                        </button>
                      </div>
                    </div>

                    {/* Presets */}
                    <div>
                      <div className="lp-section-label" style={{ marginBottom: 6, fontSize: 10.5 }}>COMMON PRESETS</div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {[
                          { label: 'Hourly', expr: '0 * * * *' },
                          { label: 'Every 12 Hours', expr: '0 */12 * * *' },
                          { label: 'Daily (Midnight)', expr: '0 0 * * *' },
                          { label: 'Weekly (Sunday)', expr: '0 0 * * 0' },
                        ].map(preset => (
                          <button
                            key={preset.expr}
                            onClick={() => {
                              setCronSchedule(preset.expr);
                              handleSaveCron(cronEnabled, preset.expr);
                            }}
                            className="lp-btn-secondary"
                            style={{ padding: '4px 10px', fontSize: 11, height: 'auto', background: 'transparent' }}
                          >
                            {preset.label} ({preset.expr})
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {cronMessage && (
                  <div className={`lp-status-bar ${cronMessage.includes('✓') ? 'success' : 'error'}`} style={{ fontSize: 12.5, padding: '10px 14px' }}>
                    {cronMessage}
                  </div>
                )}
              </div>
            </div>

            {/* 🐳 Advanced Dockerfile Code Editor Card */}
            <div className="lp-card glass" style={{ padding: 28, borderLeft: '4px solid var(--accent-primary)' }}>
              <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                🐳 Advanced Dockerfile Editor
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                Directly edit your application containerization instructions. Custom Dockerfiles override auto-detected stack templates.
              </p>

              {dockerfileLoading ? (
                <div className="flex-center" style={{ padding: '40px 0' }}>
                  <div className="loading-spinner" style={{ width: 24, height: 24 }} />
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 16 }}>
                  {/* Editor Box */}
                  <div style={{
                    display: 'flex',
                    background: '#040406',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                    fontFamily: 'monospace',
                    fontSize: 12.5,
                    lineHeight: 1.6
                  }}>
                    {/* Line Numbers Column */}
                    <div style={{
                      padding: '16px 12px',
                      color: 'rgba(255, 255, 255, 0.15)',
                      textAlign: 'right',
                      userSelect: 'none',
                      borderRight: '1px solid rgba(255,255,255,0.03)',
                      background: 'rgba(0, 0, 0, 0.2)',
                      whiteSpace: 'pre'
                    }}>
                      {dockerfile.split('\n').map((_, i) => i + 1).join('\n')}
                    </div>
                    {/* Textarea */}
                    <textarea
                      value={dockerfile}
                      onChange={e => setDockerfile(e.target.value)}
                      placeholder="# Write your custom Dockerfile here..."
                      style={{
                        flex: 1,
                        background: 'transparent',
                        color: '#f8fafc',
                        border: 'none',
                        outline: 'none',
                        padding: 16,
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        lineHeight: 'inherit',
                        resize: 'vertical',
                        minHeight: 280
                      }}
                    />
                  </div>

                  {/* Actions */}
                  <div className="flex-between">
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        className="lp-btn-secondary"
                        onClick={handleLintDockerfile}
                        disabled={linting || !dockerfile.trim()}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38 }}
                      >
                        {linting ? (
                          <div className="loading-spinner" style={{ width: 14, height: 14 }} />
                        ) : '🔍'}
                        Lint Dockerfile
                      </button>
                    </div>

                    <button
                      className="lp-btn-primary"
                      onClick={handleSaveDockerfile}
                      disabled={savingDockerfile}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 38, background: 'var(--accent-primary)' }}
                    >
                      {savingDockerfile ? (
                        <div className="loading-spinner" style={{ width: 14, height: 14 }} />
                      ) : '💾'}
                      Save & Apply
                    </button>
                  </div>

                  {/* Message Alert */}
                  {dockerfileMessage && (
                    <div className={`lp-status-bar ${dockerfileMessage.includes('saved') ? 'success' : 'error'}`} style={{ fontSize: 12.5, padding: '10px 14px' }}>
                      {dockerfileMessage}
                    </div>
                  )}

                  {/* Lint Results Widget */}
                  {lintResults && (
                    <div className="fade-in" style={{
                      padding: 20,
                      background: 'rgba(255,255,255,0.01)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      display: 'grid',
                      gap: 14
                    }}>
                      <div className="flex-between">
                        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-main)' }}>📋 Lint Diagnostic Report</span>
                        <span style={{
                          fontSize: 13,
                          fontWeight: 800,
                          color: lintResults.score >= 80 ? '#10b981' : lintResults.score >= 60 ? '#fbbf24' : '#ef4444'
                        }}>
                          Score: {lintResults.score}/100
                        </span>
                      </div>

                      {lintResults.recommendations.length === 0 ? (
                        <div style={{ fontSize: 12.5, color: '#10b981' }}>
                          ✓ No syntax or performance recommendations. Your Dockerfile is fully optimized!
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: 10 }}>
                          {lintResults.recommendations.map((rec, idx) => {
                            const badgeColor = rec.type === 'Security' ? '#ef4444' : rec.type === 'Performance' ? '#38bdf8' : '#c084fc';
                            return (
                              <div key={idx} style={{
                                padding: 12,
                                background: 'rgba(255, 255, 255, 0.01)',
                                border: '1px solid rgba(255,255,255,0.04)',
                                borderRadius: 8,
                                display: 'grid',
                                gap: 6
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: 100,
                                    background: badgeColor + '15',
                                    color: badgeColor,
                                    border: `1px solid ${badgeColor}30`
                                  }}>
                                    {rec.type.toUpperCase()}
                                  </span>
                                  <span style={{ fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>{rec.issue}</span>
                                </div>
                                <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                                  <strong style={{ color: 'var(--accent-primary)' }}>Suggested Fix:</strong> {rec.fix}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 🐳 Persistent Volume Manager Card */}
            <div className="lp-card glass" style={{ 
              padding: 28,
              borderLeft: '4px solid var(--accent-primary)',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.05) 0%, rgba(129, 140, 248, 0.02) 100%)'
            }}>
              <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                📦 Persistent Volume Manager
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                Manage files stored in your container's persistent storage path. Changes take effect immediately.
              </p>

              {!settings.persistentPath ? (
                <div style={{ padding: 18, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 10, border: '1px solid var(--border)', textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    Persistent Volume is not active for this project.
                  </div>
                  <p style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 6, marginBottom: 0 }}>
                    Specify a mount path (e.g., <code style={{ color: 'var(--accent-primary)' }}>/app/data</code>) in the Build Configuration card above and redeploy to enable.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 20 }}>
                  <div className="flex-between" style={{ padding: '12px 18px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 10 }}>
                    <div>
                      <div className="lp-section-label" style={{ margin: 0, fontSize: 10 }}>MOUNT PATH</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                        {settings.persistentPath}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div className="lp-section-label" style={{ margin: 0, fontSize: 10 }}>TOTAL STORAGE USED</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-primary)', marginTop: 2 }}>
                        {volumeDetails.totalSize > 0 
                          ? `${(volumeDetails.totalSize / 1024).toFixed(2)} KB` 
                          : '0.00 KB (Empty)'}
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex-between" style={{ marginBottom: 10 }}>
                      <div className="lp-section-label" style={{ margin: 0 }}>VOLUME FILE EXPLORER</div>
                      <button 
                        className="lp-btn-secondary" 
                        onClick={fetchVolumeDetails} 
                        disabled={volumeLoading}
                        style={{ padding: '4px 10px', height: 'auto', fontSize: 11 }}
                      >
                        {volumeLoading ? 'Scanning...' : '🔄 Refresh Files'}
                      </button>
                    </div>

                    {volumeError && (
                      <div className="lp-status-bar error" style={{ fontSize: 12, padding: '8px 12px', marginBottom: 10 }}>
                        {volumeError}
                      </div>
                    )}

                    <div style={{
                      maxHeight: '220px',
                      overflowY: 'auto',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      background: 'rgba(0,0,0,0.15)'
                    }}>
                      {volumeLoading ? (
                        <div className="flex-center" style={{ padding: '40px 0' }}>
                          <div className="loading-spinner" style={{ width: 20, height: 20 }} />
                        </div>
                      ) : !volumeDetails.files || volumeDetails.files.length === 0 ? (
                        <div style={{ color: 'var(--text-dim)', fontSize: 12, textAlign: 'center', padding: '32px 0' }}>
                          No files found in persistent storage volume.
                        </div>
                      ) : (
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'left' }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                              <th style={{ padding: '10px 14px', color: 'var(--text-muted)', fontWeight: 600 }}>File Path</th>
                              <th style={{ padding: '10px 14px', color: 'var(--text-muted)', fontWeight: 600, width: '100px' }}>Size</th>
                              <th style={{ padding: '10px 14px', color: 'var(--text-muted)', fontWeight: 600, width: '140px' }}>Last Modified</th>
                            </tr>
                          </thead>
                          <tbody>
                            {volumeDetails.files.map((file, idx) => (
                              <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', color: file.isDirectory ? 'var(--accent-primary)' : 'var(--text-main)' }}>
                                  {file.isDirectory ? `📂 ${file.name}/` : `📄 ${file.name}`}
                                </td>
                                <td style={{ padding: '10px 14px', color: 'var(--text-muted)' }}>
                                  {file.isDirectory ? '-' : `${(file.size / 1024).toFixed(2)} KB`}
                                </td>
                                <td style={{ padding: '10px 14px', color: 'var(--text-dim)' }}>
                                  {new Date(file.mtime).toLocaleDateString()} {new Date(file.mtime).toLocaleTimeString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingTop: 6 }}>
                    <button 
                      className="lp-btn-danger" 
                      onClick={handleClearVolume} 
                      disabled={volumeActionLoading || volumeLoading}
                      style={{ padding: '10px 20px', fontSize: 12 }}
                    >
                      {volumeActionLoading ? 'Wiping Volume...' : '⚠️ Wipe Volume Storage'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="lp-card" style={{ padding: 28 }}>
              <h3 style={{ fontSize: 16, color: 'var(--accent-danger)', marginBottom: 8 }}>Danger Zone</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>Permanently delete this project and all its deployments. This action is irreversible.</p>
              <button className="lp-btn-danger" onClick={handleDeleteProject}>Delete Project</button>
            </div>

            {/* GitHub Webhook Setup Card */}
            <div className="lp-card glass" style={{
              padding: 28,
              borderLeft: '4px solid #f59e0b',
              background: 'linear-gradient(135deg, rgba(245,158,11,0.05) 0%, rgba(251,191,36,0.02) 100%)'
            }}>
              <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                🔔 GitHub Auto-Deploy Webhook
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                Add this webhook to your GitHub repository to trigger automatic deployments on every push to <code style={{ color: 'var(--accent-primary)' }}>{settings.branch || 'main'}</code>.
              </p>
              <div style={{ display: 'grid', gap: 14 }}>
                {/* Webhook URL */}
                <div>
                  <div className="lp-section-label" style={{ marginBottom: 6 }}>WEBHOOK URL</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      readOnly
                      value={`${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'}/api/deploy/webhook`}
                      className="lp-input lp-input-mono"
                      style={{ flex: 1, fontSize: 12, cursor: 'text' }}
                      onFocus={e => e.target.select()}
                    />
                    <button
                      className="lp-btn-secondary"
                      style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12 }}
                      onClick={() => {
                        const url = `${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'}/api/deploy/webhook`;
                        navigator.clipboard.writeText(url);
                        alert('Webhook URL copied to clipboard!');
                      }}
                    >
                      📋 Copy
                    </button>
                  </div>
                </div>
                {/* Instructions */}
                <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>Setup steps in GitHub:</div>
                  <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, lineHeight: 1.6 }}>
                    <li>Go to your repo → <strong>Settings</strong> → <strong>Webhooks</strong> → <strong>Add webhook</strong></li>
                    <li>Paste the URL above as <strong>Payload URL</strong></li>
                    <li>Set <strong>Content type</strong> to <code style={{ color: 'var(--accent-primary)' }}>application/json</code></li>
                    <li>Select <strong>Just the push event</strong></li>
                    <li>Click <strong>Add webhook</strong> — deployments will trigger automatically!</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Automation Guide ── */}
        {activeTab === 'guide' && (() => {
          const getNodeState = (nodeName) => {
            if (!activeSimulation) return 'idle';
            const stepCount = simulationSteps.length;
            if (stepCount === 0) return 'idle';
            
            const currentStepIndex = stepCount - 1;
            
            if (activeSimulation === 'app-crash') {
              if (nodeName === 'Monitor') {
                if (currentStepIndex === 0) return 'warning';
                if (currentStepIndex >= 1 && currentStepIndex <= 4) return 'failed';
                if (currentStepIndex >= 5) return 'success';
              }
              if (nodeName === 'App') {
                if (currentStepIndex >= 0 && currentStepIndex <= 4) return 'failed';
                if (currentStepIndex === 5) return 'active';
                if (currentStepIndex >= 6) return 'success';
              }
              if (nodeName === 'AI') {
                if (currentStepIndex >= 2 && currentStepIndex <= 4) return 'active';
                if (currentStepIndex === 5) return 'success';
              }
              if (nodeName === 'Build') {
                if (currentStepIndex === 4) return 'active';
                if (currentStepIndex >= 5) return 'success';
              }
              if (nodeName === 'Proxy') {
                if (currentStepIndex === 5) return 'active';
                if (currentStepIndex >= 6) return 'success';
              }
            }
            
            if (activeSimulation === 'ssl-expired') {
              if (nodeName === 'Monitor') {
                if (currentStepIndex >= 0 && currentStepIndex <= 1) return 'active';
                if (currentStepIndex >= 2 && currentStepIndex <= 6) return 'warning';
                if (currentStepIndex === 7) return 'success';
              }
              if (nodeName === 'Proxy') {
                if (currentStepIndex === 1 || currentStepIndex === 2) return 'warning';
                if (currentStepIndex >= 3 && currentStepIndex <= 5) return 'active';
                if (currentStepIndex >= 6) return 'success';
              }
              if (nodeName === 'AI') {
                if (currentStepIndex >= 2 && currentStepIndex <= 5) return 'active';
                if (currentStepIndex >= 6) return 'success';
              }
            }
            
            if (activeSimulation === 'build-fail') {
              if (nodeName === 'Dev') {
                if (currentStepIndex === 0) return 'active';
                if (currentStepIndex >= 7) return 'success';
              }
              if (nodeName === 'Webhook') {
                if (currentStepIndex === 0) return 'active';
                if (currentStepIndex >= 1) return 'success';
              }
              if (nodeName === 'Build') {
                if (currentStepIndex === 1) return 'active';
                if (currentStepIndex >= 2 && currentStepIndex <= 4) return 'failed';
                if (currentStepIndex === 5) return 'active';
                if (currentStepIndex >= 6) return 'success';
              }
              if (nodeName === 'AI') {
                if (currentStepIndex >= 3 && currentStepIndex <= 5) return 'active';
                if (currentStepIndex >= 6) return 'success';
              }
              if (nodeName === 'Proxy' || nodeName === 'App') {
                if (currentStepIndex >= 8) return 'success';
              }
            }
            
            return 'idle';
          };

          const getNodeClass = (nodeName) => {
            const state = getNodeState(nodeName);
            const isSelected = selectedNode === nodeName;
            
            let classes = ['sre-node'];
            if (isSelected) classes.push('selected');
            if (state === 'active') classes.push('active-state');
            else if (state === 'success') classes.push('success-state');
            else if (state === 'warning') classes.push('warning-state');
            else if (state === 'failed') classes.push('failed-state');
            
            return classes.join(' ');
          };

          return (
            <div className="fade-in" style={{ display: 'grid', gap: 24, maxWidth: 1000, color: 'var(--text-main)' }}>
              {/* Header Card */}
              <div className="lp-card glass" style={{
                padding: 32,
                background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.05) 0%, rgba(129, 140, 248, 0.03) 100%)',
                borderLeft: '4px solid var(--accent-primary)',
              }}>
                <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, letterSpacing: '-0.02em', margin: 0 }}>How LaunchLive Automates Your DevOps & SRE</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6, maxWidth: 680, margin: '8px 0 0 0' }}>
                  LaunchLive runs automated SRE monitoring, zero-downtime server scaling, and self-healing infrastructure in the background. Explore the tabs below to learn, simulate, and chat about how we keep your application fast, secure, and always online.
                </p>
              </div>

              {/* Guide Sub-Navigation */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                {[
                  { id: 'systems', label: 'SRE Systems', icon: '📖' },
                  { id: 'chat', label: 'SRE AI Chat', icon: '💬' },
                  { id: 'sandbox', label: 'DevOps Sandbox', icon: '🎮' },
                  { id: 'topology', label: 'Architecture Map', icon: '🗺️' }
                ].map(sub => (
                  <button
                    key={sub.id}
                    onClick={() => setGuideSubTab(sub.id)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '20px',
                      border: '1px solid ' + (guideSubTab === sub.id ? 'var(--accent-primary)' : 'var(--border)'),
                      background: guideSubTab === sub.id ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.02)',
                      color: guideSubTab === sub.id ? '#fff' : 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: '13px',
                      fontWeight: 600,
                      transition: 'all 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    <span>{sub.icon}</span> {sub.label}
                  </button>
                ))}
              </div>

              {/* Sub-tab 1: Systems Guide */}
              {guideSubTab === 'systems' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 400px), 1fr))', gap: 24 }}>
                  {[
                    {
                      title: 'AI Auto-Healing & Self-Correction',
                      icon: '🤖',
                      explanation: 'Like a robot engineer that watches your app 24/7. If your code breaks, it automatically finds the bug, writes a fix, and repairs the server while you sleep.',
                      schema: 'Crash ➔ Capture Logs ➔ AI Diagnose ➔ Test Fix ➔ Auto-Deploy ✅',
                      why: 'If your application crashes in production, it normally stays down until a developer manually reads logs and fixes the code.',
                      works: 'LaunchLive catches exit codes, analyzes the latest crash logs using SRE AI, tests the generated code patch in an isolated sandbox, and automatically hot-swaps traffic to the healed container.',
                      benefits: 'Dramatically minimizes system downtime by autonomously resolving common runtime/build bugs.',
                      how: 'Enable "Auto Heal" in the Settings tab, and customize your commit or Pull Request notifications.',
                    },
                    {
                      title: 'Ephemeral Pull Request Previews',
                      icon: '🔍',
                      explanation: 'Creates a temporary, private live-link of your app every time you make a code change, so you can safely test new features before they go live.',
                      schema: 'Git PR Open ➔ Build Isolated App ➔ Let\'s Encrypt SSL ➔ Share Link ✅',
                      why: 'Testing pull requests in isolation without affecting the main staging/production environments is difficult to configure and costly to host.',
                      works: 'Spins up an isolated preview replica of your app (including local databases and private env vars) whenever a new PR is opened, commenting a secure link on your GitHub.',
                      benefits: 'Allows teams to test and review code changes in isolation before merging into staging/production.',
                      how: 'Simply open a Pull Request in your connected GitHub repository. LaunchLive will handle the rest automatically.',
                    },
                    {
                      title: 'Zero-Downtime Container Scaling',
                      icon: '⚡',
                      explanation: 'Upgrades your servers and handles massive traffic spikes seamlessly behind the scenes, without disconnecting any of your active users.',
                      schema: 'Scale Trigger ➔ Spawn Container ➔ Health Check ➔ Nginx Route Swap ✅',
                      why: 'Standard server restarts or scaling resources usually disconnect active users, causing downtime.',
                      works: 'LaunchLive spins up the new container version, performs health checks to ensure it is healthy, and dynamically re-routes traffic using Nginx before shutting down the old container.',
                      benefits: 'Seamless scaling under high load with zero dropped connections.',
                      how: 'Change the CPU or RAM limits in the Settings tab. The system handles the rolling update.',
                    },
                    {
                      title: 'Automated Security Patching',
                      icon: '🛡️',
                      explanation: 'An automated security guard that scans your code for vulnerabilities and automatically updates outdated packages to keep hackers out.',
                      schema: 'Security Scan ➔ OSV Check ➔ AI Dependency Patch ➔ Deploy PR ✅',
                      why: 'Keeping dependencies secure against newly discovered CVEs requires constant monitoring and manual upgrades.',
                      works: 'LaunchLive regularly scans your dependency tree. If a vulnerability is found, the AI calculates the safest upgrade path, tests it, and prepares a pull request with the fix.',
                      benefits: 'Protects against exploits automatically, keeping your dependencies up-to-date with minimal effort.',
                      how: 'Check the "Security" tab. If vulnerabilities are found, click "Apply Auto-Fix" to generate a secure Pull Request.',
                    },
                    {
                      title: 'Automated SSL & DNS Routing',
                      icon: '🌐',
                      explanation: 'Connects your custom domains and secures them with free SSL certificates in seconds, without having to mess with complicated DNS settings.',
                      schema: 'New Custom Domain ➔ Cloudflare DNS Hook ➔ SSL Gen ➔ Cron Renewal ✅',
                      why: 'Setting up DNS records and securing them with SSL certificates can be a tedious process of DNS configuration and web server tuning.',
                      works: 'LaunchLive integrates with Cloudflare to set up subdomains and custom domains instantly. It configures Let\'s Encrypt certificates and automatically renews them via a weekly cron job.',
                      benefits: 'Provides instant, secure access (HTTPS) to your deployments without manually managing domain records or SSL.',
                      how: 'Add a custom domain in the "Domains" tab and configure your CNAME. SSL is provisioned automatically.',
                    },
                    {
                      title: 'Real-time Observability & Telemetry',
                      icon: '📈',
                      explanation: 'A live dashboard that shows you exactly how fast your app is running, how many people are visiting, and where the errors are happening.',
                      schema: 'Inbound Request ➔ Middleware Interceptor ➔ Redis sliding window ➔ Charts ✅',
                      why: 'Identifying slow API endpoints, traffic spikes, or memory leaks requires complex monitoring setups.',
                      works: 'An Nginx/Express middleware interceptor streams live performance metrics directly to a Redis-backed sliding window, providing instant access to latency, traffic, and error rates.',
                      benefits: 'Gives you real-time performance insights and instant anomaly detection.',
                      how: 'Monitor real-time application health under the "Live Metrics" and "Analytics" tabs.'
                    }
                  ].map((g, i) => (
                    <div key={i} className="lp-card glass hover-lift" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <div>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          <span style={{ fontSize: 20 }}>{g.icon}</span>
                          <h4 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>{g.title}</h4>
                        </div>

                        {/* Pipeline Monospace Schema */}
                        <div style={{
                          fontFamily: 'var(--font-mono, monospace)',
                          fontSize: '11px',
                          color: 'var(--accent-primary)',
                          background: 'rgba(56, 189, 248, 0.04)',
                          padding: '6px 12px',
                          borderRadius: 6,
                          border: '1px solid rgba(56, 189, 248, 0.1)',
                          marginBottom: 12
                        }}>
                          {g.schema}
                        </div>

                        {/* Explanation */}
                        <p style={{ fontSize: 13, color: 'var(--text-main)', lineHeight: 1.5, marginBottom: 16 }}>
                          {g.explanation}
                        </p>
                        {/* Side by side Problem / Solution */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 12 }}>
                          {/* Problem */}
                          <div style={{ padding: 10, borderLeft: '3px solid var(--accent-danger)', background: 'rgba(239, 68, 68, 0.02)', borderRadius: '0 6px 6px 0' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-danger)', textTransform: 'uppercase', marginBottom: 2 }}>❌ The Problem (Without LaunchLive)</div>
                            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.4 }}>{g.why}</div>
                          </div>
                          
                          {/* Solution */}
                          <div style={{ padding: 10, borderLeft: '3px solid var(--accent-success)', background: 'rgba(16, 185, 129, 0.02)', borderRadius: '0 6px 6px 0' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-success)', textTransform: 'uppercase', marginBottom: 2 }}>✅ The Solution (With LaunchLive)</div>
                            <div style={{ fontSize: 12.5, color: 'var(--text-main)', lineHeight: 1.4 }}>{g.works}</div>
                          </div>
                        </div>

                        {/* Details */}
                        <div style={{ fontSize: 13, marginBottom: 8 }}>
                          <strong style={{ color: 'var(--accent-secondary)' }}>💡 Real-World Value:</strong> <span style={{ color: 'var(--text-muted)' }}>{g.benefits}</span>
                        </div>
                        <div style={{ fontSize: 13 }}>
                          <strong style={{ color: '#fff' }}>🛠️ How to use:</strong> <span style={{ color: 'var(--text-muted)' }}>{g.how}</span>
                        </div>
                      </div>
                      <div style={{ marginTop: 'auto', paddingTop: 10 }}>
                        <button
                          onClick={() => handleDeepDive(g.title, g.works)}
                          className="lp-btn-secondary"
                          style={{ width: '100%', fontSize: 12, padding: '8px 12px' }}
                        >
                          💡 AI Stack Deep-Dive
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Sub-tab 2: SRE AI Chat */}
              {guideSubTab === 'chat' && (
                <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 24, minHeight: '600px', alignItems: 'stretch' }}>
                  {/* Left Pane: Chat Window */}
                  <div className="lp-card glass" style={{ display: 'flex', flexDirection: 'column', padding: 24, height: '650px', background: 'rgba(9, 9, 14, 0.4)' }}>
                    {/* Chat Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          position: 'relative',
                          width: 36,
                          height: 36,
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 18,
                          boxShadow: '0 0 10px rgba(56, 189, 248, 0.4)'
                        }}>
                          🤖
                          <div style={{
                            position: 'absolute',
                            bottom: 0,
                            right: 0,
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: '#10b981',
                            border: '2px solid #09090e',
                            boxShadow: '0 0 5px #10b981'
                          }} />
                        </div>
                        <div>
                          <h4 style={{ fontSize: 15, fontWeight: 700, color: '#fff', margin: 0 }}>SRE AI Architect</h4>
                          <span style={{ fontSize: 11, color: 'var(--accent-primary)', fontWeight: 600 }}>Active Platform Monitor</span>
                        </div>
                      </div>
                      <button
                        onClick={handleClearChat}
                        className="lp-btn-secondary"
                        style={{ fontSize: 11, padding: '4px 10px', height: 'auto', border: '1px solid var(--border)' }}
                      >
                        🗑️ Reset Chat
                      </button>
                    </div>

                    {/* Messages Scroll Area */}
                    <div style={{
                      flex: 1,
                      overflowY: 'auto',
                      paddingRight: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 16,
                      marginBottom: 16
                    }}>
                      {architectMessages.map((msg, idx) => {
                        const isUser = msg.role === 'user';
                        return (
                          <div key={idx} style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: isUser ? 'flex-end' : 'flex-start',
                            maxWidth: '85%',
                            alignSelf: isUser ? 'flex-end' : 'flex-start',
                            animation: 'fade-in 0.25s ease-out forwards'
                          }}>
                            {/* Sender Name */}
                            <span style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4, display: 'block', paddingLeft: isUser ? 0 : 4, paddingRight: isUser ? 4 : 0 }}>
                              {isUser ? 'Developer' : 'SRE AI Architect'}
                            </span>

                            {/* Message Bubble */}
                            <div style={{
                              padding: '14px 18px',
                              borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                              background: isUser 
                                ? 'linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(129, 140, 248, 0.15) 100%)' 
                                : 'rgba(255, 255, 255, 0.02)',
                              border: '1px solid ' + (isUser ? 'rgba(56, 189, 248, 0.25)' : 'var(--border)'),
                              color: isUser ? '#fff' : 'var(--text-main)',
                              fontSize: '13.5px',
                              lineHeight: 1.6,
                              boxShadow: isUser ? '0 4px 15px rgba(56, 189, 248, 0.05)' : 'none',
                              position: 'relative'
                            }}>
                              {/* Content */}
                              <div style={{ whiteSpace: 'pre-wrap' }}>
                                {formatMessageContent(msg.content)}
                              </div>

                              {/* Copy Button */}
                              {!isUser && (
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(msg.content);
                                    alert('Copied AI message to clipboard!');
                                  }}
                                  style={{
                                    position: 'absolute',
                                    top: 6,
                                    right: 6,
                                    background: 'rgba(0,0,0,0.3)',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    color: 'var(--text-dim)',
                                    borderRadius: 4,
                                    fontSize: 10,
                                    padding: '2px 4px',
                                    cursor: 'pointer',
                                    opacity: 0.7,
                                    transition: 'opacity 0.2s'
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.opacity = 1}
                                  onMouseLeave={e => e.currentTarget.style.opacity = 0.7}
                                >
                                  📋 Copy
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {architectLoading && (
                        <div style={{
                          alignSelf: 'flex-start',
                          maxWidth: '85%',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          color: 'var(--accent-secondary)',
                          fontSize: 13,
                          padding: '12px 16px',
                          background: 'rgba(255, 255, 255, 0.02)',
                          borderRadius: '12px',
                          border: '1px solid var(--border)'
                        }}>
                          <div className="loading-spinner" style={{ width: 12, height: 12 }} />
                          <span>SRE AI Architect is analyzing telemetry data...</span>
                        </div>
                      )}

                      <div ref={chatEndRef} />
                    </div>

                    {/* Suggestion Prompts Section */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 8, letterSpacing: '0.05em' }}>
                        💡 Click a suggestion to ask immediately:
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {[
                          { label: '💥 Diagnose Crashes', query: 'How does LaunchLive auto-healing diagnose runtime crashes? Can you show me an example of an OOM resolution?' },
                          { label: '🛡️ Security Audits', query: 'What security scans are run on my repository? How does the dependency vulnerability patcher work?' },
                          { label: '⚡ Nginx & SSL Routing', query: 'Explain how Let\'s Encrypt SSL certificates are requested, provisioned, and automatically renewed. What does the Nginx routing configuration look like?' },
                          { label: '📦 Resource Limits', query: 'How are Docker CPU and memory limit flags enforced on my application container? What happens if they are exceeded?' }
                        ].map((sug, i) => (
                          <button
                            key={i}
                            onClick={() => handleAskArchitect(sug.query)}
                            disabled={architectLoading}
                            style={{
                              background: 'rgba(255, 255, 255, 0.02)',
                              border: '1px solid var(--border)',
                              borderRadius: '20px',
                              padding: '6px 12px',
                              fontSize: '11.5px',
                              color: 'var(--text-muted)',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              fontWeight: 500
                            }}
                            onMouseEnter={e => {
                              if (!architectLoading) {
                                e.currentTarget.style.borderColor = 'var(--accent-primary)';
                                e.currentTarget.style.color = '#fff';
                                e.currentTarget.style.background = 'rgba(56, 189, 248, 0.05)';
                              }
                            }}
                            onMouseLeave={e => {
                              if (!architectLoading) {
                                e.currentTarget.style.borderColor = 'var(--border)';
                                e.currentTarget.style.color = 'var(--text-muted)';
                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                              }
                            }}
                          >
                            {sug.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Chat Input */}
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      handleAskArchitect(customQuestion);
                    }} style={{ display: 'flex', gap: 10 }}>
                      <input
                        type="text"
                        value={customQuestion}
                        onChange={(e) => setCustomQuestion(e.target.value)}
                        placeholder="Ask SRE AI about Let's Encrypt certificates, Nginx configuration, container limits..."
                        disabled={architectLoading}
                        className="lp-input"
                        style={{ flex: 1, fontSize: 13, height: '42px', padding: '0 16px' }}
                      />
                      <button
                        type="submit"
                        className="lp-btn-primary"
                        disabled={architectLoading || !customQuestion.trim()}
                        style={{
                          background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
                          height: '42px',
                          padding: '0 20px',
                          fontSize: 13,
                          fontWeight: 700,
                          color: '#fff',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6
                        }}
                      >
                        <span>💬</span> Send
                      </button>
                    </form>
                  </div>

                  {/* Right Pane: Live Telemetry Context & Recommendations */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* Project SRE Config Status Card */}
                    <div className="lp-card glass" style={{ padding: 20, borderLeft: '4px solid var(--accent-success)' }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                        🟢 Infrastructure Configuration
                      </h4>
                      <div style={{ display: 'grid', gap: 12 }}>
                        {[
                          { label: 'Auto-Healing (SRE)', value: project?.autoHeal ? 'ENABLED (Auto-Recover)' : 'DISABLED', color: project?.autoHeal ? 'var(--accent-success)' : 'var(--text-dim)' },
                          { label: 'Container RAM Allocation', value: `${project?.ramLimitMB || 256} MB`, color: 'var(--accent-secondary)' },
                          { label: 'Container CPU Allocation', value: `${project?.cpuLimit || 0.5} Cores (Shares)`, color: 'var(--accent-primary)' },
                          { label: 'Reverse Proxy Routing', value: 'Nginx Edge Gateway (HTTP/2)', color: 'var(--text-muted)' },
                          { label: 'Domain Binding', value: project?.subdomain ? `${project.subdomain}.launchlive.in` : 'Dev IP Proxy', color: '#fff' }
                        ].map((it, idx) => (
                          <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: 8 }}>
                            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{it.label}</span>
                            <span style={{ fontSize: 12, fontWeight: 600, color: it.color }}>{it.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* SRE Operations Checklist */}
                    <div className="lp-card glass" style={{ padding: 20 }}>
                      <h4 style={{ fontSize: 14, fontWeight: 700, color: '#fff', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
                        ⚡ Platform SRE Checklist
                      </h4>
                      <div style={{ display: 'grid', gap: 12 }}>
                        {[
                          { title: 'Docker Sandboxing', desc: 'Isolates code in secure containers.', status: 'ACTIVE', color: 'var(--accent-success)' },
                          { title: 'SSL (Let\'s Encrypt)', desc: 'Automatic provision & cron renewals.', status: 'SECURED', color: 'var(--accent-primary)' },
                          { title: 'Nginx Traffic Gate', desc: 'Zero-downtime rolling deploys.', status: 'ROUTING', color: 'var(--accent-secondary)' },
                          { title: 'Telemetry Monitor', desc: 'Continuous health check loops.', status: 'WATCHING', color: 'var(--accent-success)' },
                          { title: 'OSV Dependency Scan', desc: 'Vulnerability scanners in compiler.', status: 'SECURED', color: 'var(--accent-success)' }
                        ].map((chk, idx) => (
                          <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            <div style={{ fontSize: 14, marginTop: 2 }}>✅</div>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: 12.5, fontWeight: 600, color: '#fff' }}>{chk.title}</span>
                                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', color: chk.color }}>{chk.status}</span>
                              </div>
                              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0 0', lineHeight: 1.3 }}>{chk.desc}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Stack-Specific AI Recommendation */}
                    <div className="lp-card glass" style={{
                      padding: 20,
                      background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.05) 0%, rgba(56, 189, 248, 0.02) 100%)',
                      borderLeft: '4px solid var(--accent-secondary)'
                    }}>
                      <h4 style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px 0' }}>
                        💡 AI Recommendation
                      </h4>
                      {project?.stack === 'react' || project?.stack === 'vue' || project?.stack === 'svelte' || project?.stack === 'next' ? (
                        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                          Your application runs on <strong>{project.stack.toUpperCase()}</strong>. Since this is a client-side bundle, Nginx acts as a high-performance web server caching assets statically.
                          Configure browser caching or CDN rules on Cloudflare to improve your PageSpeed score by up to 40%.
                        </p>
                      ) : (
                        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                          Your application is a backend node stack (<strong>{project?.stack?.toUpperCase() || 'node'}</strong>). Ensure your container does not exceed the allotted memory limit.
                          If your app crashes due to OOM (Out Of Memory), the platform's **SRE Auto-Healer** will immediately restart it and adjust resource scaling hooks.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Sub-tab 3: DevOps Sandbox (Visual Simulation) */}
              {guideSubTab === 'sandbox' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
                  {/* Quick Start Guide */}
                  {showSandboxGuide && (
                    <div className="lp-card glass fade-in" style={{
                      padding: 20,
                      border: '1px solid rgba(129, 140, 248, 0.2)',
                      background: 'linear-gradient(135deg, rgba(30, 27, 75, 0.4) 0%, rgba(15, 23, 42, 0.4) 100%)',
                      position: 'relative'
                    }}>
                      <button 
                        onClick={() => setShowSandboxGuide(false)}
                        style={{
                          position: 'absolute',
                          top: 12,
                          right: 12,
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--text-muted)',
                          fontSize: 16,
                          cursor: 'pointer'
                        }}
                        title="Dismiss Guide"
                      >
                        ✕
                      </button>
                      
                      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <span style={{ fontSize: 24 }}>📖</span>
                        <div>
                          <h4 style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 8 }}>
                            DevOps Sandbox — Quick Start Tutorial
                          </h4>
                          <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                            Welcome to the DevOps Sandbox! This interactive simulator lets you trigger real-world production outages and watch LaunchLive's <strong>Zero-Touch Self-Healing system</strong> diagnose and repair them automatically.
                          </p>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12, fontSize: 12.5, color: 'var(--text-dim)' }}>
                            <div style={{ background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 8 }}>
                              <strong>1. SRE Flow Diagram:</strong> Click any of the nodes (e.g. 💻 Developer, 🧠 AI SRE Agent) to learn what that part of the infrastructure does under the hood.
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 8 }}>
                              <strong>2. Choose a Mode:</strong> Set the toggle to <strong>Auto-Play</strong> to watch the disaster repair itself, or <strong>Step-by-Step</strong> to click through the steps manually.
                            </div>
                            <div style={{ background: 'rgba(255,255,255,0.02)', padding: 10, borderRadius: 8 }}>
                              <strong>3. Trigger Outages:</strong> Click any scenario button below (like 💥 <em>Simulate App Crash</em>) and watch the terminal logs and telemetry gauges react in real-time!
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* SRE Infrastructure Flow Diagram */}
                  <div className="lp-card glass" style={{ padding: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                        Live SRE Infrastructure Flow Diagram
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        💡 Click any node to inspect its SRE role
                      </span>
                    </div>

                    <div style={{
                      background: 'rgba(0,0,0,0.15)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      padding: 24,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 20
                    }}>
                      <div style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                        alignItems: 'center',
                        gap: 16
                      }}>
                        {/* Node: Developer */}
                        <div 
                          className={getNodeClass('Dev')} 
                          onClick={() => setSelectedNode('Dev')}
                        >
                          💻 Developer
                        </div>
                        <div style={{ color: 'var(--text-dim)', fontSize: 16 }}>➔</div>

                        {/* Node: Webhook */}
                        <div 
                          className={getNodeClass('Webhook')} 
                          onClick={() => setSelectedNode('Webhook')}
                        >
                          🔗 Webhook Router
                        </div>
                        <div style={{ color: 'var(--text-dim)', fontSize: 16 }}>➔</div>

                        {/* Node: Build Engine */}
                        <div 
                          className={getNodeClass('Build')} 
                          onClick={() => setSelectedNode('Build')}
                        >
                          ⚙️ Build Engine
                        </div>
                        <div style={{ color: 'var(--text-dim)', fontSize: 16 }}>➔</div>

                        {/* Node: Nginx Proxy */}
                        <div 
                          className={getNodeClass('Proxy')} 
                          onClick={() => setSelectedNode('Proxy')}
                        >
                          🌐 Nginx Gateway
                        </div>
                        <div style={{ color: 'var(--text-dim)', fontSize: 16 }}>➔</div>

                        {/* Node: App Container */}
                        <div 
                          className={getNodeClass('App')} 
                          onClick={() => setSelectedNode('App')}
                        >
                          📦 App Container
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginTop: 12 }}>
                        {/* Node: Telemetry */}
                        <div 
                          className={getNodeClass('Monitor')} 
                          onClick={() => setSelectedNode('Monitor')}
                        >
                          📈 Telemetry Monitor
                        </div>

                        <div style={{ color: 'var(--text-dim)', display: 'flex', alignItems: 'center', fontSize: 16 }}>⇄</div>

                        {/* Node: AI Healer */}
                        <div 
                          className={getNodeClass('AI')} 
                          onClick={() => setSelectedNode('AI')}
                        >
                          🧠 AI SRE Agent
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Selected Node Inspector Panel */}
                  <div className="lp-card glass" style={{
                    padding: 24,
                    borderLeft: '4px solid var(--accent-secondary)',
                    background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.05) 0%, rgba(56, 189, 248, 0.02) 100%)',
                  }}>
                    {(() => {
                      const activeNode = selectedNode || 'AI';
                      const desc = NODE_DESCRIPTIONS[activeNode];
                      if (!desc) return null;
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                            <div>
                              <h4 style={{ fontSize: 16, fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                                {desc.title} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>— {desc.role}</span>
                              </h4>
                            </div>
                            <button
                              onClick={() => handleAskAboutNode(activeNode)}
                              className="lp-btn-secondary"
                              style={{ fontSize: 12, padding: '6px 14px', borderColor: 'var(--accent-secondary)' }}
                            >
                              💬 Ask SRE AI about this
                            </button>
                          </div>
                          
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 16 }}>
                            <div style={{ padding: 12, background: 'rgba(239, 68, 68, 0.03)', borderLeft: '3px solid var(--accent-danger)', borderRadius: '4px' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-danger)', textTransform: 'uppercase', marginBottom: 4 }}>⚠️ The Problem (Without LaunchLive)</div>
                              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc.why}</div>
                            </div>
                            <div style={{ padding: 12, background: 'rgba(56, 189, 248, 0.03)', borderLeft: '3px solid var(--accent-primary)', borderRadius: '4px' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase', marginBottom: 4 }}>⚙️ SRE Internal Mechanics</div>
                              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc.works}</div>
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 16 }}>
                            <div style={{ padding: 12, background: 'rgba(16, 185, 129, 0.03)', borderLeft: '3px solid var(--accent-success)', borderRadius: '4px' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-success)', textTransform: 'uppercase', marginBottom: 4 }}>💡 Real-World Value</div>
                              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc.value}</div>
                            </div>
                            <div style={{ padding: 12, background: 'rgba(129, 140, 248, 0.03)', borderLeft: '3px solid var(--accent-secondary)', borderRadius: '4px' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>🛠️ How to Enable / Configure</div>
                              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{desc.how}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* DevOps Simulator & Controls */}
                  <div className="lp-card glass" style={{ padding: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <div>
                          <h3 style={{ fontSize: 16, color: '#fff' }}>🎮 DevOps & SRE Incident Simulator</h3>
                          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                            Run simulated production outages and watch LaunchLive self-heal.
                          </p>
                        </div>
                        {!showSandboxGuide && (
                          <button
                            onClick={() => setShowSandboxGuide(true)}
                            className="lp-btn-secondary"
                            style={{ padding: '4px 10px', fontSize: 11, alignSelf: 'center' }}
                          >
                            📖 Show Guide
                          </button>
                        )}
                      </div>
                      
                      {/* Simulation Status Info */}
                      {activeSimulation && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Speed: 
                          </span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {[0.5, 1, 2].map(speed => (
                              <button
                                key={speed}
                                onClick={() => {
                                  setSimulationSpeed(speed);
                                  speedRef.current = speed;
                                }}
                                style={{
                                  padding: '2px 6px',
                                  fontSize: 10,
                                  borderRadius: 4,
                                  border: '1px solid ' + (simulationSpeed === speed ? 'var(--accent-primary)' : 'var(--border)'),
                                  background: simulationSpeed === speed ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                                  color: simulationSpeed === speed ? '#fff' : 'var(--text-muted)',
                                  cursor: 'pointer'
                                }}
                              >
                                {speed}x
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Control Panel / State Selector */}
                    {!activeSimulation ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                        {/* Mode Toggle Selector */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Simulation Mode:</span>
                          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden' }}>
                            <button
                              onClick={() => setStepMode('auto')}
                              style={{
                                padding: '6px 12px',
                                fontSize: 12,
                                border: 'none',
                                background: stepMode === 'auto' ? 'var(--accent-primary)' : 'transparent',
                                color: stepMode === 'auto' ? '#fff' : 'var(--text-muted)',
                                cursor: 'pointer',
                                fontWeight: 600
                              }}
                            >
                              ⚡ Auto-Play
                            </button>
                            <button
                              onClick={() => setStepMode('manual')}
                              style={{
                                padding: '6px 12px',
                                fontSize: 12,
                                border: 'none',
                                background: stepMode === 'manual' ? 'var(--accent-primary)' : 'transparent',
                                color: stepMode === 'manual' ? '#fff' : 'var(--text-muted)',
                                cursor: 'pointer',
                                fontWeight: 600
                              }}
                            >
                              🛠️ Step-by-Step
                            </button>
                          </div>
                        </div>

                        {/* Trigger Buttons */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                          <button
                            onClick={() => handleRunSimulation('app-crash', stepMode)}
                            className="lp-btn-secondary"
                            style={{ flex: '1 1 200px', padding: '12px', fontSize: 13, borderColor: 'var(--accent-danger)' }}
                          >
                            💥 Simulate App Crash (OOM)
                          </button>
                          <button
                            onClick={() => handleRunSimulation('build-fail', stepMode)}
                            className="lp-btn-secondary"
                            style={{ flex: '1 1 200px', padding: '12px', fontSize: 13, borderColor: 'var(--accent-warning)' }}
                          >
                            🛑 Simulate Build Failure
                          </button>
                          <button
                            onClick={() => handleRunSimulation('ssl-expired', stepMode)}
                            className="lp-btn-secondary"
                            style={{ flex: '1 1 200px', padding: '12px', fontSize: 13, borderColor: 'var(--accent-primary)' }}
                          >
                            🔒 Simulate SSL Expiry
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20, padding: 12, background: 'rgba(255, 255, 255, 0.02)', borderRadius: 10, border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>
                              Running: {SIMULATION_SCENARIOS[activeSimulation]?.name}
                            </span>
                            <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: stepMode === 'auto' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(129, 140, 248, 0.15)', color: stepMode === 'auto' ? 'var(--accent-primary)' : 'var(--accent-secondary)' }}>
                              {stepMode === 'auto' ? 'Auto-Play ⚡' : 'Step Mode 🛠️'}
                            </span>
                          </div>

                          {/* Stepper Controls */}
                          <div style={{ display: 'flex', gap: 8 }}>
                            {stepMode === 'auto' && (
                              <button
                                onClick={() => {
                                  const nextPaused = !isPaused;
                                  setIsPaused(nextPaused);
                                  isPausedRef.current = nextPaused;
                                }}
                                className="lp-btn-secondary"
                                style={{ padding: '6px 12px', fontSize: 12 }}
                              >
                                {isPaused ? '▶️ Resume' : '⏸️ Pause'}
                              </button>
                            )}
                            
                            {(stepMode === 'manual' || isPaused) && (
                              <button
                                onClick={handleNextSimulationStep}
                                className="lp-btn-primary"
                                style={{ padding: '6px 12px', fontSize: 12, background: 'var(--accent-secondary)' }}
                                disabled={currentStep >= (SIMULATION_SCENARIOS[activeSimulation]?.steps.length || 1) - 1 || simulationLoading}
                              >
                                Next Step ➔
                              </button>
                            )}

                            <button
                              onClick={handleResetSimulation}
                              className="lp-btn-danger"
                              style={{ padding: '6px 12px', fontSize: 12 }}
                            >
                              Stop 🔄
                            </button>
                          </div>
                        </div>

                        {/* Progress bar */}
                        {(() => {
                          const totalSteps = SIMULATION_SCENARIOS[activeSimulation]?.steps.length || 1;
                          const pct = ((currentStep + 1) / totalSteps) * 100;
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
                                <span>Progress</span>
                                <span>Step {currentStep + 1} of {totalSteps}</span>
                              </div>
                              <div style={{ width: '100%', height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent-primary)', transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }} />
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Simulated Console + Telemetry Metrics Grid */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: activeSimulation ? 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' : '1fr',
                      gap: 20,
                      alignItems: 'stretch'
                    }}>
                      {/* Left Pane: Simulator Screen */}
                      <div style={{
                        background: '#09090e',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        padding: 20,
                        fontFamily: 'var(--font-mono, monospace)',
                        fontSize: 13,
                        minHeight: 220,
                        color: '#e2e8f0',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.8)'
                      }}>
                        <div>
                          {simulationSteps.length === 0 && <span style={{ color: 'var(--text-dim)' }}>Select a scenario above to run the live simulator...</span>}
                          {simulationSteps.map((step, idx) => (
                            <div key={idx} style={{
                              marginBottom: 8,
                              color: step.includes('❌') ? '#ef4444' : step.includes('⚠️') ? '#f59e0b' : step.includes('✅') ? '#10b981' : '#e2e8f0',
                              animation: 'fade-in 0.2s ease-out forwards'
                            }}>
                              {step}
                            </div>
                          ))}
                        </div>
                        {simulationLoading && (
                          <div style={{ marginTop: 10, color: 'var(--accent-secondary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="loading-spinner" style={{ width: 12, height: 12 }}></div> Running automated recovery workflows...
                          </div>
                        )}
                      </div>

                      {/* Right Pane: Simulated Telemetry Metrics Dashboard */}
                      {activeSimulation && (() => {
                        const m = getSimulatedMetrics(activeSimulation, currentStep);
                        return (
                          <div className="fade-in" style={{
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid var(--border)',
                            borderRadius: 12,
                            padding: 20,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: 16
                          }}>
                            {/* Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 10 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.05em' }}>📡 LIVE SRE TELEMETRY STREAM</span>
                              <span style={{
                                fontSize: 9.5,
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 10,
                                background: m.code === 200 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                color: m.code === 200 ? 'var(--accent-success)' : 'var(--accent-danger)'
                              }}>
                                STATUS: {m.status.toUpperCase()}
                              </span>
                            </div>

                            {/* Gauges Grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
                              {/* CPU Meter */}
                              <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.02)' }}>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>CPU Load</div>
                                <div style={{ fontSize: 20, fontWeight: 800, color: m.cpu > 80 ? 'var(--accent-danger)' : 'var(--accent-primary)', fontFamily: 'var(--font-mono, monospace)' }}>
                                  {m.cpu}%
                                </div>
                                <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                                  <div style={{ width: `${m.cpu}%`, height: '100%', background: m.cpu > 80 ? 'var(--accent-danger)' : 'var(--accent-primary)', transition: 'all 0.3s' }} />
                                </div>
                              </div>

                              {/* RAM Meter */}
                              <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.02)' }}>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>Memory Usage</div>
                                <div style={{ fontSize: 20, fontWeight: 800, color: m.ram > 450 ? 'var(--accent-danger)' : 'var(--accent-success)', fontFamily: 'var(--font-mono, monospace)' }}>
                                  {m.ram} MB
                                </div>
                                <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                                  <div style={{ width: `${(m.ram / 512) * 100}%`, height: '100%', background: m.ram > 450 ? 'var(--accent-danger)' : 'var(--accent-success)', transition: 'all 0.3s' }} />
                                </div>
                              </div>
                            </div>

                            {/* Details Row */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
                              {/* HTTP status */}
                              <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>HTTP Code</div>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono, monospace)' }}>
                                    {m.code ? m.code : '—'}
                                  </span>
                                </div>
                                <span style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: m.code === 200 ? 'var(--accent-success)' : m.code ? 'var(--accent-danger)' : 'var(--text-dim)'
                                }}>
                                  {m.code === 200 ? 'SUCCESS' : m.code ? 'FAIL' : 'OFFLINE'}
                                </span>
                              </div>

                              {/* SSL Status */}
                              <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>SSL Age</div>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'var(--font-mono, monospace)' }}>
                                    {m.ssl} days
                                  </span>
                                </div>
                                <span style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: m.ssl > 0 ? 'var(--accent-primary)' : 'var(--accent-danger)'
                                }}>
                                  {m.ssl > 0 ? 'SECURE' : 'EXPIRED'}
                                </span>
                              </div>
                            </div>

                            {/* Live Alert Box */}
                            <div style={{
                              padding: '10px 14px',
                              background: m.code !== 200 && m.code !== null ? 'rgba(239,68,68,0.05)' : 'rgba(16,185,129,0.05)',
                              border: '1px solid ' + (m.code !== 200 && m.code !== null ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)'),
                              borderRadius: 8,
                              fontSize: 12,
                              color: m.code !== 200 && m.code !== null ? 'var(--accent-danger)' : 'var(--accent-success)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 8
                            }}>
                              <span>
                                {m.code !== 200 && m.code !== null ? '⚠️' : '🟢'}
                              </span>
                              <span style={{ flex: 1, lineHeight: 1.4 }}>
                                {m.code === 502 && 'Nginx Gateway reports 502 Bad Gateway. App is offline.'}
                                {m.code === 500 && 'Container crashed due to OOM (Out Of Memory). Restarting.'}
                                {m.code === 495 && 'TLS verification failed: Handshake error (SSL Expired).'}
                                {m.code === 200 && 'Application responding successfully. Ingress traffic secure.'}
                                {m.code === null && 'Awaiting simulator initialization...'}
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Post-Simulation Report */}
                    {simulationResponse && (
                      <div className="fade-in" style={{
                        background: 'rgba(255, 255, 255, 0.02)',
                        border: '1px solid var(--border)',
                        borderRadius: 12,
                        padding: 24,
                        marginTop: 20
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                          <span style={{ fontSize: 20 }}>🧠</span>
                          <h4 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>SRE Incident Playbook: Analysis & Remediation</h4>
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)' }}>
                          {formatMessageContent(simulationResponse)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sub-tab 4: Architecture Map */}
              {guideSubTab === 'topology' && (
                <div className="lp-card glass" style={{ padding: 24 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div>
                      <h3 style={{ fontSize: 16, marginBottom: 4 }}>🗺️ Custom Infrastructure Topology Map</h3>
                      <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                        Request a dynamically generated architectural map representing your current project's configuration, ports, and domains.
                      </p>
                    </div>
                    <button
                      onClick={handleGenerateArchitecture}
                      className="lp-btn-primary"
                      style={{ background: 'var(--accent-primary)', minWidth: 150 }}
                      disabled={archDiagramLoading}
                    >
                      {archDiagramLoading ? 'Mapping...' : 'Generate Map'}
                    </button>
                  </div>

                  {archDiagramLoading && (
                    <div style={{
                      minHeight: 200,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      background: 'rgba(0,0,0,0.15)',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                    }}>
                      <div className="loading-spinner" style={{ width: 24, height: 24 }}></div>
                      <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Scanning active network, container bindings, and DNS configurations...</span>
                    </div>
                  )}

                  {archDiagram && (
                    <div className="fade-in" style={{
                      background: '#09090e',
                      border: '1px solid var(--border)',
                      borderRadius: 12,
                      padding: 20,
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: 13,
                      color: '#e2e8f0',
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap'
                    }}>
                      {formatMessageContent(archDiagram)}
                    </div>
                  )}
                </div>
              )}

              {/* Deep Dive Modal Overlay */}
              {deepDiveSystem && (
                <div style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  background: 'rgba(2, 6, 23, 0.85)',
                  backdropFilter: 'blur(8px)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 9999,
                  padding: 20
                }}>
                  <div className="lp-card glass" style={{
                    maxWidth: 750,
                    width: '100%',
                    maxHeight: '85vh',
                    overflowY: 'auto',
                    padding: 28,
                    border: '1px solid var(--border-strong)',
                    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.7)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 20 }}>
                      <h3 style={{ fontSize: 18, color: '#fff' }}>🔍 AI Deep-Dive: {deepDiveSystem.title}</h3>
                      <button
                        onClick={() => setDeepDiveSystem(null)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}
                      >
                        &times;
                      </button>
                    </div>

                    {deepDiveLoading ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 250, gap: 12 }}>
                        <div className="loading-spinner" style={{ width: 24, height: 24 }}></div>
                        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Analyzing repository structure and generating custom configuration walk-throughs...</span>
                      </div>
                  ) : (
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-muted)' }}>
                      {formatMessageContent(deepDiveResponse)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          );
        })()}

        {/* ── Domains ── */}
        {activeTab === 'domains' && (
          <div className="fade-in">
            <DomainManager project={project} onUpdate={loadProject} />
          </div>
        )}

        {/* ── Live Metrics + Cost Estimator ── */}
        {activeTab === 'metrics' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 16 }}>
              {[
                { label: 'Total Deployments', value: deployments.length },
                { label: 'Successful', value: deployments.filter(d => d.status === 'success').length, color: 'var(--accent-success)' },
                { label: 'Failed', value: deployments.filter(d => d.status === 'failed').length, color: 'var(--accent-danger)' },
                { label: 'Avg. Build Time', value: deployments.length ? `${(deployments.filter(d=>d.duration).reduce((a,d)=>a+d.duration,0)/deployments.filter(d=>d.duration).length/1000||0).toFixed(1)}s` : '—' },
              ].map(m => (
                <div key={m.label} className="lp-card" style={{ padding: '20px 24px' }}>
                  <div className="lp-section-label">{m.label}</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: m.color || 'var(--text-main)', marginTop: 4 }}>{m.value}</div>
                </div>
              ))}
            </div>
            <MetricsChart projectId={id} socketRef={socketRef} />

            {/* 💰 Cost Estimator Card */}
            <div className="lp-card glass" style={{ padding: 28, borderLeft: '4px solid #a78bfa', background: 'linear-gradient(135deg, rgba(167,139,250,0.06) 0%, rgba(56,189,248,0.03) 100%)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>💰 Monthly Cost Estimator</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>AI analysis of your CPU/RAM usage patterns to predict VPS costs.</p>
                </div>
                <button className="lp-btn-secondary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={handleLoadCostEstimate} disabled={costLoading}>
                  {costLoading ? 'Analyzing...' : '🔄 Run Estimate'}
                </button>
              </div>
              {costLoading && <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-muted)' }}><div className="loading-spinner" style={{ width: 16, height: 16 }} /> Analyzing usage patterns...</div>}
              {costData && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 16, marginBottom: 20 }}>
                    {[
                      { label: 'Current Monthly Cost', value: `$${costData.currentMonthlyCostUSD}`, color: '#34d399' },
                      { label: 'Projected (next month)', value: `$${costData.projectedCostUSD}`, color: '#fbbf24' },
                      { label: 'Avg CPU Usage', value: `${costData.avgCpuPercent}%`, color: 'var(--accent-primary)' },
                      { label: 'Avg RAM Usage', value: `${costData.avgRamMB} MB`, color: 'var(--accent-secondary)' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '16px 20px', background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
                        <div className="lp-section-label">{s.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                    <div className="lp-section-label" style={{ marginBottom: 8 }}>COST BREAKDOWN</div>
                    <div style={{ display: 'flex', gap: 24, fontSize: 13, color: 'var(--text-muted)' }}>
                      <span>Base: <strong style={{ color: 'var(--text-main)' }}>${costData.breakdown?.base}</strong></span>
                      <span>CPU: <strong style={{ color: 'var(--text-main)' }}>${costData.breakdown?.cpu}</strong></span>
                      <span>RAM: <strong style={{ color: 'var(--text-main)' }}>${costData.breakdown?.ram}</strong></span>
                    </div>
                  </div>
                  <div className="lp-section-label" style={{ marginBottom: 8 }}>AI RECOMMENDATIONS</div>
                  {costData.recommendations?.map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                      <span style={{ color: '#a78bfa', flexShrink: 0 }}>•</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Edge Analytics + Build Trends ── */}
        {activeTab === 'analytics' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <AnalyticsDashboard projectId={id} />

            {/* Build Performance Trends */}
            <div className="lp-card glass" style={{ padding: 28, borderLeft: '4px solid #38bdf8', background: 'linear-gradient(135deg, rgba(56,189,248,0.05) 0%, rgba(129,140,248,0.02) 100%)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>📊 Build Performance Trends</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Track build duration, success rate, and get AI optimization tips.</p>
                </div>
                <button className="lp-btn-secondary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={handleLoadTrends} disabled={trendsLoading}>
                  {trendsLoading ? 'Analyzing...' : '🔄 Analyze Trends'}
                </button>
              </div>
              {trendsLoading && <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-muted)' }}><div className="loading-spinner" style={{ width: 16, height: 16 }} /> Analyzing build history...</div>}
              {buildTrends && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 16, marginBottom: 20 }}>
                    {[
                      { label: 'Avg Build Time', value: buildTrends.avgBuildTimeMs ? `${(buildTrends.avgBuildTimeMs/1000).toFixed(1)}s` : 'N/A', color: 'var(--accent-primary)' },
                      { label: 'Success Rate', value: `${buildTrends.successRate}%`, color: buildTrends.successRate >= 80 ? '#34d399' : buildTrends.successRate >= 50 ? '#fbbf24' : '#f87171' },
                      { label: 'Total Builds', value: buildTrends.totalBuilds || 0, color: 'var(--text-main)' },
                      { label: 'Trend', value: buildTrends.trend === 'improving' ? '↑ Improving' : buildTrends.trend === 'degrading' ? '↓ Degrading' : '→ Stable', color: buildTrends.trend === 'improving' ? '#34d399' : buildTrends.trend === 'degrading' ? '#f87171' : '#fbbf24' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '16px 20px', background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
                        <div className="lp-section-label">{s.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Visual Build Duration Chart */}
                  {buildTrends.history && buildTrends.history.length > 0 && (
                    <div style={{ padding: '20px 24px', background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)', marginBottom: 20 }}>
                      <div className="lp-section-label" style={{ marginBottom: 16 }}>BUILD DURATION HISTORY (LAST 10 BUILDS)</div>
                      <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', height: 160, gap: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
                        {buildTrends.history.map((h, idx) => {
                          const durationSec = h.duration ? (h.duration / 1000).toFixed(1) : 0;
                          const maxDuration = Math.max(...buildTrends.history.map(d => d.duration || 0), 1000);
                          const pctHeight = Math.max(((h.duration || 0) / maxDuration) * 100, 10);
                          
                          let barColor = 'rgba(56, 189, 248, 0.4)';
                          let hoverColor = 'var(--accent-primary)';
                          let barBorder = '1px solid rgba(56, 189, 248, 0.6)';
                          
                          if (h.status === 'failed') {
                            barColor = 'rgba(239, 68, 68, 0.3)';
                            hoverColor = '#ef4444';
                            barBorder = '1px solid rgba(239, 68, 68, 0.5)';
                          } else if (h.isAutoHeal) {
                            barColor = 'rgba(16, 185, 129, 0.3)';
                            hoverColor = '#10b981';
                            barBorder = '1px solid rgba(16, 185, 129, 0.5)';
                          }

                          return (
                            <div 
                              key={h._id || idx} 
                              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1, minWidth: 40, height: '100%', justifyContent: 'end' }}
                              title={`Commit: ${h.commitMessage || 'No Message'}\nDuration: ${durationSec}s\nStatus: ${h.status}`}
                            >
                              <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{durationSec}s</span>
                              <div 
                                className="build-chart-bar"
                                style={{
                                  width: '100%',
                                  height: `${pctHeight}%`,
                                  background: barColor,
                                  border: barBorder,
                                  borderRadius: '4px 4px 0 0',
                                  transition: 'all 0.2s',
                                  cursor: 'pointer',
                                }}
                                onMouseEnter={(e) => { e.target.style.background = hoverColor; }}
                                onMouseLeave={(e) => { e.target.style.background = barColor; }}
                              />
                              <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                                #{idx + 1}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 10, height: 10, background: 'rgba(56, 189, 248, 0.4)', border: '1px solid rgba(56, 189, 248, 0.6)', borderRadius: 2 }} />
                          <span>Success</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 10, height: 10, background: 'rgba(239, 68, 68, 0.3)', border: '1px solid rgba(239, 68, 68, 0.5)', borderRadius: 2 }} />
                          <span>Failed</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 10, height: 10, background: 'rgba(16, 185, 129, 0.3)', border: '1px solid rgba(16, 185, 129, 0.5)', borderRadius: 2 }} />
                          <span>Auto-Healed</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {buildTrends.tips?.length > 0 && (
                    <div>
                      <div className="lp-section-label" style={{ marginBottom: 8 }}>AI OPTIMIZATION TIPS</div>
                      {buildTrends.tips.map((tip, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, padding: '10px 14px', background: 'rgba(56,189,248,0.05)', borderRadius: 8, border: '1px solid rgba(56,189,248,0.15)' }}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
                          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tip}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Security Scanner ── */}
        {activeTab === 'security' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="lp-card glass" style={{ padding: 20, borderLeft: '4px solid #f87171', background: 'linear-gradient(135deg, rgba(248, 113, 113, 0.04) 0%, rgba(251, 191, 36, 0.01) 100%)' }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, margin: 0 }}>🛡️ Automated Vulnerability Scanner & CVE Patching</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5, margin: 0 }}>
                <strong>How it works:</strong> LaunchLive automatically scans your dependencies for known vulnerabilities (CVEs) on every build. When security threats are found, you can generate verified AI patches that upgrade packages or resolve issues with one click.
              </p>
            </div>
            <div className="lp-card glass" style={{ padding: 28, borderLeft: '4px solid #f87171', background: 'linear-gradient(135deg, rgba(248,113,113,0.05) 0%, rgba(251,191,36,0.02) 100%)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>🛡️ Dependency Vulnerability Scanner</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Powered by OSV.dev — scans your package.json against the global CVE database.</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {vulnData && vulnData.packages?.some(p => p.vulns.some(v => v.severity === 'critical' || v.severity === 'high')) && (
                    <button className="lp-btn-secondary" style={{ padding: '7px 16px', fontSize: 13, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }} onClick={handleVulnAutoFix} disabled={vulnFixLoading}>
                      {vulnFixLoading ? '🔄 Generating...' : '🤖 AI Auto-Fix Critical'}
                    </button>
                  )}
                  <button className="lp-btn-primary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={handleVulnScan} disabled={vulnLoading}>
                    {vulnLoading ? 'Scanning...' : '🔍 Run CVE Scan'}
                  </button>
                </div>
              </div>

              {vulnLoading && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 20, color: 'var(--text-muted)' }}>
                  <div className="loading-spinner" style={{ width: 20, height: 20 }} />
                  Querying OSV.dev vulnerability database...
                </div>
              )}

              {vulnData && !vulnLoading && (
                <div>
                  {/* Summary Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 110px), 1fr))', gap: 12, marginBottom: 24 }}>
                    {[
                      { label: 'Critical', count: vulnData.summary?.critical || 0, color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
                      { label: 'High', count: vulnData.summary?.high || 0, color: '#fb923c', bg: 'rgba(251,146,60,0.1)' },
                      { label: 'Medium', count: vulnData.summary?.medium || 0, color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
                      { label: 'Low', count: vulnData.summary?.low || 0, color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '16px 20px', background: s.bg, borderRadius: 12, border: `1px solid ${s.color}30`, textAlign: 'center' }}>
                        <div style={{ fontSize: 32, fontWeight: 800, color: s.color }}>{s.count}</div>
                        <div style={{ fontSize: 12, color: s.color, fontWeight: 600, marginTop: 4 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Vulnerable Packages */}
                  {vulnData.packages?.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '32px 0', color: '#34d399', fontSize: 15 }}>✅ No known vulnerabilities found in your dependencies!</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {vulnData.packages?.map(pkg => (
                        <div key={pkg.name} style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: '16px 20px', border: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14 }}>{pkg.name}</span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>v{pkg.version}</span>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{pkg.vulns.length} issue{pkg.vulns.length !== 1 ? 's' : ''}</span>
                          </div>
                          {pkg.vulns.map(v => (
                            <div key={v.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 8, padding: '10px 12px', background: 'var(--bg-main)', borderRadius: 8, border: `1px solid ${{ critical: 'rgba(248,113,113,0.3)', high: 'rgba(251,146,60,0.3)', medium: 'rgba(251,191,36,0.3)', low: 'rgba(52,211,153,0.2)' }[v.severity] || 'var(--border)'}` }}>
                              <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: { critical: 'rgba(248,113,113,0.2)', high: 'rgba(251,146,60,0.2)', medium: 'rgba(251,191,36,0.2)', low: 'rgba(52,211,153,0.15)' }[v.severity], color: { critical: '#f87171', high: '#fb923c', medium: '#fbbf24', low: '#34d399' }[v.severity], flexShrink: 0, textTransform: 'uppercase' }}>{v.severity}</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, color: 'var(--text-main)', marginBottom: 2 }}>{v.summary}</div>
                                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-dim)' }}>
                                  <a href={v.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)' }}>{v.id}</a>
                                  {v.fixedIn && <span>→ Fixed in v{v.fixedIn}</span>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* AI Fix Commands */}
                  {vulnFixData && (
                    <div style={{ marginTop: 20, padding: 20, background: 'rgba(52,211,153,0.05)', borderRadius: 12, border: '1px solid rgba(52,211,153,0.2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <span style={{ fontSize: 16 }}>🤖</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: '#34d399' }}>AI-Generated Security Fix Commands</span>
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>{vulnFixData.description}</p>
                      <pre style={{ background: '#090d16', borderRadius: 8, padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12, color: '#e2e8f0', overflowX: 'auto', marginBottom: 16 }}>
                        {vulnFixData.patchCommands?.join('\n') || 'No specific commands generated.'}
                      </pre>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          className="lp-btn-primary"
                          style={{
                            padding: '8px 20px',
                            fontSize: 13,
                            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            border: 'none',
                            cursor: applyingVulnFix ? 'not-allowed' : 'pointer'
                          }}
                          onClick={handleApplyVulnFix}
                          disabled={applyingVulnFix}
                        >
                          {applyingVulnFix ? '🛡️ Applying patches...' : '🛡️ Apply Patches & Redeploy'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 16 }}>Last scanned: {vulnData.scannedAt ? new Date(vulnData.scannedAt).toLocaleString() : 'Just now'}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PR Previews ── */}
        {activeTab === 'previews' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="lp-card glass" style={{ padding: 20, borderLeft: '4px solid var(--accent-primary)', background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.04) 0%, rgba(129, 140, 248, 0.01) 100%)' }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, margin: 0 }}>🔍 Ephemeral Pull Request (PR) Preview Environments</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5, margin: 0 }}>
                <strong>How it works:</strong> LaunchLive listens to your GitHub repository webhooks. When you open a Pull Request (PR), it automatically builds an isolated preview container of that branch and comments the live URL directly on your PR. When you merge or close the PR, the container is automatically deleted to save resources.
              </p>
            </div>
            <div className="lp-card glass" style={{ padding: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                  <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    🔍 PR Preview Environments
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                    Deploy isolated sandboxed versions of your application for active GitHub Pull Requests.
                  </p>
                </div>
              </div>

              {/* Form to manual deploy PR */}
              <form onSubmit={handleCreatePreview} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', padding: 18, borderRadius: 12, marginBottom: 24 }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 700 }}>PR Number</div>
                  <input
                    type="number"
                    value={newPreviewPR}
                    onChange={e => setNewPreviewPR(e.target.value)}
                    placeholder="e.g. 12"
                    className="lp-input"
                    style={{ background: 'rgba(0,0,0,0.2)' }}
                    required
                  />
                </div>
                <div style={{ flex: 2, minWidth: 200 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 700 }}>PR Branch Name</div>
                  <input
                    type="text"
                    value={newPreviewBranch}
                    onChange={e => setNewPreviewBranch(e.target.value)}
                    placeholder="e.g. feature/login-page"
                    className="lp-input"
                    style={{ background: 'rgba(0,0,0,0.2)' }}
                    required
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button
                    type="submit"
                    disabled={creatingPreview || !project.subdomain}
                    className="lp-btn-primary"
                    style={{ height: 42, padding: '0 24px', fontSize: 13, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)', fontWeight: 600 }}
                  >
                    {creatingPreview ? 'Building Preview...' : '🚀 Spin Up Preview'}
                  </button>
                </div>
              </form>

              {/* Previews List */}
              {previewsLoading && previews.length === 0 ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                  <div className="loading-spinner" style={{ width: 16, height: 16 }} />
                  Loading active preview environments...
                </div>
              ) : previews.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 0', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 12, background: 'rgba(0,0,0,0.05)' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                  <h4 style={{ margin: '0 0 6px 0', color: 'var(--text-main)', fontSize: 14 }}>No Active PR Previews</h4>
                  <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 13 }}>Specify a PR number and branch above to spawn a dedicated test container.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: 20 }}>
                  {previews.map(p => (
                    <div key={p.prNumber} className="lp-card glass" style={{ padding: 20, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-main)' }}>PR #{p.prNumber}</span>
                          
                          {/* Badge */}
                          {p.status === 'live' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }}></span> Live
                            </span>
                          )}
                          {p.status === 'building' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block', animation: 'pulse-dot 1s infinite' }}></span> Building
                            </span>
                          )}
                          {p.status === 'failed' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                              ⚠️ Failed
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                          Branch: <code style={{ color: 'var(--accent-primary)', fontSize: 12 }}>{p.branch}</code>
                        </div>

                        {p.previewUrl && p.status === 'live' && (
                          <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8 }}>
                            URL: <a href={p.previewUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600 }}>{p.previewUrl}</a>
                          </div>
                        )}

                        {p.error && p.status === 'failed' && (
                          <div style={{ fontSize: 11, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: 10, color: '#ef4444', fontFamily: 'var(--font-mono)', maxHeight: 100, overflowY: 'auto', wordBreak: 'break-all' }}>
                            Error: {p.error}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 10, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
                        {p.status === 'live' && p.previewUrl && (
                          <a href={p.previewUrl} target="_blank" rel="noreferrer" className="lp-btn-primary" style={{ flex: 1, textAlign: 'center', textDecoration: 'none', padding: '8px 0', fontSize: 12, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            Open Preview ↗
                          </a>
                        )}
                        <button onClick={() => handleDestroyPreview(p.prNumber)} className="lp-btn-secondary" style={{ flex: 1, color: 'var(--accent-danger)', border: '1px solid rgba(239,68,68,0.15)', padding: '8px 0', fontSize: 12, borderRadius: 6, height: 'auto' }}>
                          Destroy Preview
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── AI Deployment Advisor ── */}
        {activeTab === 'advisor' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900 }}>
            <div className="lp-card glass" style={{ padding: 32, borderLeft: '4px solid #818cf8', background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.08) 0%, rgba(56, 189, 248, 0.02) 100%)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', right: -20, top: -20, opacity: 0.1, fontSize: 140 }}>🧠</div>
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 12, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 26 }}>🧠</span> AI Code Readiness & SRE Advisor
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6, margin: 0, maxWidth: 650 }}>
                LaunchLive AI dynamically scans your repository structure, configuration files, and package dependencies in real-time. It calculates a deployment readiness score and uncovers missing environment variables, security risks, or setup errors before you trigger a deployment—guaranteeing zero-downtime launches.
              </p>
            </div>

            <div className="lp-card glass" style={{ padding: 32, border: '1px solid rgba(129, 140, 248, 0.2)', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                    ⚡ Pre-Deployment Analysis
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6, margin: 0 }}>
                    Run a comprehensive AI scan to score your deployment readiness (0–100) before going live.
                  </p>
                </div>
                <button 
                  className="lp-btn-primary" 
                  style={{ 
                    padding: '10px 24px', 
                    fontSize: 14, 
                    fontWeight: 600,
                    background: 'linear-gradient(135deg, #6366f1 0%, #3b82f6 100%)', 
                    boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)',
                    border: 'none',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'all 0.2s'
                  }} 
                  onClick={handleReadinessCheck} 
                  disabled={readinessLoading}
                >
                  {readinessLoading ? (
                    <><div className="spinner" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTop: '2px solid #fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} /> Analyzing Repository...</>
                  ) : (
                    <>✨ Run AI Readiness Check</>
                  )}
                </button>
              </div>

              {readinessLoading && (
                <div style={{ padding: '40px 0', textAlign: 'center' }}>
                  <div className="spinner" style={{ width: 36, height: 36, border: '3px solid rgba(129,140,248,0.2)', borderTop: '3px solid #818cf8', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 20px auto' }} />
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-main)', marginBottom: 8 }}>AI is scanning your repository...</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Checking dependencies, security headers, and configuration files.</div>
                </div>
              )}

              {readiness && !readinessLoading && (
                <div className="fade-in">
                  {/* Score Display */}
                  <div className="glass" style={{ display: 'flex', gap: 32, alignItems: 'center', marginBottom: 32, padding: '28px 32px', background: 'rgba(0,0,0,0.3)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)', position: 'relative', overflow: 'hidden', boxShadow: 'inset 0 0 20px rgba(129, 140, 248, 0.05)' }}>
                    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 200, background: `linear-gradient(90deg, transparent, ${readiness.score >= 80 ? 'rgba(52,211,153,0.05)' : readiness.score >= 50 ? 'rgba(251,191,36,0.05)' : 'rgba(248,113,113,0.05)'})` }} />
                    
                    {/* Animated score circle */}
                    <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}>
                      <svg width="110" height="110" viewBox="0 0 110 110">
                        <circle cx="55" cy="55" r="48" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
                        <circle cx="55" cy="55" r="48" fill="none"
                          stroke={readiness.score >= 80 ? '#34d399' : readiness.score >= 50 ? '#fbbf24' : '#f87171'}
                          strokeWidth="10" strokeLinecap="round"
                          strokeDasharray={`${(readiness.score / 100) * 301.5} 301.5`}
                          transform="rotate(-90 55 55)" style={{ transition: 'stroke-dasharray 1.5s cubic-bezier(0.4, 0, 0.2, 1)' }}
                        />
                      </svg>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 28, fontWeight: 900, color: readiness.score >= 80 ? '#34d399' : readiness.score >= 50 ? '#fbbf24' : '#f87171', letterSpacing: '-1px' }}>{readiness.score}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600 }}>/ 100</span>
                      </div>
                    </div>
                    <div style={{ zIndex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div style={{ fontSize: 22, fontWeight: 800, color: readiness.score >= 80 ? '#34d399' : readiness.score >= 50 ? '#fbbf24' : '#f87171' }}>
                          {readiness.score >= 80 ? '🟢 Ready for Production' : readiness.score >= 50 ? '🟡 Attention Recommended' : '🔴 Deployment High Risk'}
                        </div>
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5 }}>
                        <strong style={{ color: 'var(--text-main)' }}>{readiness.passed} of {readiness.total}</strong> critical deployment checks passed successfully.
                        {readiness.score < 80 && (
                          <span style={{ display: 'block', marginTop: 4 }}>Please review the flagged items below to ensure a stable release.</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Checklist */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Detailed Diagnostic Report</h4>
                    <div style={{ height: 1, flex: 1, background: 'rgba(255,255,255,0.05)' }} />
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {readiness.checks?.map((check, i) => (
                      <div key={i} style={{
                        display: 'flex', gap: 16, alignItems: 'flex-start',
                        padding: '18px 20px', borderRadius: 12,
                        background: check.passed ? 'rgba(52,211,153,0.03)' : 'rgba(248,113,113,0.03)',
                        border: `1px solid ${check.passed ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.2)'}`,
                        transition: 'transform 0.2s',
                      }}>
                        <div style={{ 
                          width: 28, height: 28, borderRadius: '50%', flexShrink: 0, 
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: check.passed ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                          color: check.passed ? '#34d399' : '#f87171',
                          fontSize: 14
                        }}>
                          {check.passed ? '✓' : check.severity === 'critical' ? '✕' : '!'}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                            <span style={{ fontWeight: 600, fontSize: 15, color: check.passed ? 'var(--text-main)' : '#f87171' }}>{check.name}</span>
                            {!check.passed && (
                              <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
                                background: check.severity === 'critical' ? 'rgba(248,113,113,0.15)' : check.severity === 'high' ? 'rgba(251,146,60,0.15)' : 'rgba(251,191,36,0.1)',
                                color: check.severity === 'critical' ? '#f87171' : check.severity === 'high' ? '#fb923c' : '#fbbf24',
                                border: `1px solid ${check.severity === 'critical' ? 'rgba(248,113,113,0.3)' : check.severity === 'high' ? 'rgba(251,146,60,0.3)' : 'rgba(251,191,36,0.2)'}`
                              }}>{check.severity}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 13.5, color: 'var(--text-muted)', lineHeight: 1.5 }}>{check.recommendation}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!readiness && !readinessLoading && (
                <div style={{ textAlign: 'center', padding: '60px 0', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 16, background: 'rgba(0,0,0,0.1)' }}>
                  <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.8 }}>🤖</div>
                  <h4 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0', color: 'var(--text-main)' }}>AI Advisor is standing by</h4>
                  <p style={{ fontSize: 14, color: 'var(--text-muted)', maxWidth: 400, margin: '0 auto', lineHeight: 1.5 }}>
                    Click "Run AI Readiness Check" to initiate a deep scan of your repository structure, missing env variables, and potential deployment bottlenecks.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Team Permissions ── */}
        {activeTab === 'team' && (
          <div className="fade-in">
            <TeamManager project={project} currentUser={user} />
          </div>
        )}

        {/* ── AI Co-Pilot ── */}
        {activeTab === 'ai' && (
          <div className="fade-in">
            <AIChat
              projectId={id}
              activeTab={activeTab}
              deployments={deployments}
              cpuUsage={cpuUsage}
              ramUsage={ramUsage}
            />
          </div>
        )}

        {/* ── AI Docs & Flow ── */}
        {activeTab === 'ai-docs' && (
          <div className="fade-in">
            {renderAiDocsTab()}
          </div>
        )}
            </div>{/* /inner-flex */}
          </div>{/* /lp-content-container */}

        </div>{/* /lp-detail-layout */}
      </div>{/* /lp-page */}
      </main>
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        currentProjectId={id}
        currentProjectDeployments={deployments}
      />
    </div>
  );
}