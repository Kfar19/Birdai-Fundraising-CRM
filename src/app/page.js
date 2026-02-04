'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { INVESTOR_TYPES, PIPELINE_STAGES, PITCH_ANGLES } from '../lib/constants';
import { calculateEngagementScore, getOutreachUrgency, generateRecommendations, suggestPitchAngle, getAIPrioritizedInvestors } from '../lib/engine';
import { buildInitialInvestors } from '../data/investors';

// ═══════════════════════════════════════════════════════════════
// STORAGE — uses localStorage for persistence in browser
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY = 'birdai-fundraising-v3';

function loadInvestors() {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return null;
}

function saveInvestors(investors) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(investors));
  } catch (e) {
    console.error('Failed to save:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const S = {
  card: { background: '#13151A', border: '1px solid #2D3748', borderRadius: '12px', padding: '24px', marginBottom: '20px' },
  cardTitle: { fontSize: '15px', fontWeight: '700', color: '#FFFFFF', marginBottom: '16px', letterSpacing: '0.5px', textTransform: 'uppercase' },
  badge: (color) => ({ display: 'inline-block', padding: '5px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600', background: color + '20', color, letterSpacing: '0.3px' }),
  input: { width: '100%', padding: '10px 14px', background: '#0A0A0F', border: '1px solid #2D3748', borderRadius: '8px', color: '#F1F5F9', fontSize: '14px', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
  select: { padding: '10px 14px', background: '#0A0A0F', border: '1px solid #2D3748', borderRadius: '8px', color: '#F1F5F9', fontSize: '14px', fontFamily: 'inherit', outline: 'none' },
  btn: (v = 'default') => ({ padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit', background: v === 'primary' ? '#10B981' : v === 'danger' ? '#EF4444' : '#2D3748', color: v === 'primary' ? '#000' : '#FFFFFF', transition: 'all 0.15s' }),
  th: { textAlign: 'left', padding: '14px 16px', fontSize: '12px', fontWeight: '700', color: '#A0AEC0', letterSpacing: '0.5px', textTransform: 'uppercase', borderBottom: '2px solid #2D3748' },
  td: { padding: '14px 16px', fontSize: '14px', borderBottom: '1px solid rgba(45,55,72,0.3)', verticalAlign: 'top', color: '#E2E8F0' },
};

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

function Dashboard({ investors, setView, setSelectedId, setFilters }) {
  const committed = investors.filter(i => i.stage === 'committed');
  const totalCommitted = committed.reduce((sum, i) => sum + (i.commitment || 0), 0);
  const active = investors.filter(i => !['committed', 'passed', 'identified'].includes(i.stage));
  const needsAction = investors.filter(i => { const u = getOutreachUrgency(i); return u && u.level === 'now'; });

  const byStage = {};
  for (const s of Object.keys(PIPELINE_STAGES)) byStage[s] = investors.filter(i => i.stage === s).length;

  const byType = {};
  for (const i of investors) byType[i.type] = (byType[i.type] || 0) + 1;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'TOTAL PIPELINE', value: investors.length, sub: 'contacts', color: '#F8FAFC', filter: { stage: 'all' } },
          { label: 'COMMITTED', value: `$${(totalCommitted / 1e6).toFixed(2)}M`, sub: '/ $2M target', color: '#10B981', bar: totalCommitted / 2e6, filter: { stage: 'committed' } },
          { label: 'ACTIVE PIPELINE', value: active.length, sub: 'in progress', color: '#3B82F6', filter: { stage: 'all', priority: 'all' }, activeOnly: true },
          { label: 'NEEDS ACTION', value: needsAction.length, sub: 'urgent', color: '#EF4444', filter: { priority: 'high', stage: 'all' }, urgentOnly: true },
        ].map((kpi, idx) => (
          <div 
            key={idx} 
            onClick={() => {
              setFilters(prev => ({ ...prev, ...kpi.filter, search: '' }));
              setView('pipeline');
            }}
            style={{ 
              ...S.card, 
              cursor: 'pointer', 
              transition: 'all 0.15s',
              border: '1px solid transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = kpi.color; e.currentTarget.style.transform = 'translateY(-2px)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            <div style={{ fontSize: '13px', color: kpi.color === '#F8FAFC' ? '#A0AEC0' : kpi.color, fontWeight: '700', letterSpacing: '0.5px', marginBottom: '10px' }}>{kpi.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
              <span style={{ fontSize: '36px', fontWeight: '800', color: kpi.color }}>{kpi.value}</span>
              <span style={{ fontSize: '14px', color: '#A0AEC0' }}>{kpi.sub}</span>
            </div>
            {kpi.bar !== undefined && (
              <div style={{ marginTop: '8px', height: '4px', background: '#1E293B', borderRadius: '2px' }}>
                <div style={{ height: '4px', background: '#10B981', borderRadius: '2px', width: `${Math.min(100, kpi.bar * 100)}%` }} />
              </div>
            )}
            <div style={{ fontSize: '10px', color: '#64748B', marginTop: '8px' }}>Click to view →</div>
          </div>
        ))}
      </div>

      {/* Pipeline Funnel */}
      <div style={S.card}>
        <div style={{ ...S.cardTitle, marginBottom: '20px' }}>Pipeline Funnel</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', height: '140px', paddingTop: '20px' }}>
          {Object.entries(PIPELINE_STAGES).map(([key, stage]) => {
            const count = byStage[key] || 0;
            const maxCount = Math.max(...Object.values(byStage), 1);
            const barHeight = Math.max(16, (count / maxCount) * 100);
            return (
              <div 
                key={key} 
                onClick={() => { setFilters(prev => ({ ...prev, stage: key, search: '' })); setView('pipeline'); }}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', height: '100%', justifyContent: 'flex-end', cursor: 'pointer', transition: 'transform 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.05)'}
                onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
              >
                <span style={{ fontSize: '16px', fontWeight: '700', color: stage.color }}>{count}</span>
                <div style={{ width: '100%', height: `${barHeight}px`, background: stage.color + '30', borderRadius: '6px 6px 0 0', border: `2px solid ${stage.color}50` }} />
                <span style={{ fontSize: '12px', color: '#A0AEC0', textAlign: 'center', lineHeight: '1.4', minHeight: '32px' }}>{stage.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* Urgent */}
        <div style={S.card}>
          <div style={{ ...S.cardTitle, color: '#EF4444' }}>⚡ Urgent Actions</div>
          {needsAction.slice(0, 8).map(i => (
            <div 
              key={i.id} 
              onClick={() => { setSelectedId(i.id); setView('pipeline'); }} 
              style={{ padding: '12px 8px', marginLeft: '-8px', marginRight: '-8px', borderBottom: '1px solid rgba(45,55,72,0.3)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '6px', transition: 'background 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.1)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ color: '#3B82F6', fontSize: '16px' }}>→</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#FFFFFF' }}>{i.name}</div>
                  <div style={{ fontSize: '13px', color: '#A0AEC0' }}>{i.company || i.source}</div>
                </div>
              </div>
              <span style={S.badge(getOutreachUrgency(i)?.color || '#64748B')}>{(i.nextAction || 'Follow up').slice(0, 30)}</span>
            </div>
          ))}
        </div>

        {/* Type Breakdown */}
        <div style={S.card}>
          <div style={S.cardTitle}>By Investor Type</div>
          {Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
            const cfg = INVESTOR_TYPES[type] || INVESTOR_TYPES.other;
            return (
              <div 
                key={type} 
                onClick={() => { setFilters(prev => ({ ...prev, type: type, stage: 'all', search: '' })); setView('pipeline'); }}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 4px', marginLeft: '-4px', marginRight: '-4px', cursor: 'pointer', borderRadius: '6px', transition: 'background 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.1)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span style={{ fontSize: '14px', color: '#E2E8F0' }}>{cfg.icon} {cfg.label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: `${Math.min(140, (count / investors.length) * 300)}px`, height: '6px', background: cfg.color, borderRadius: '3px' }} />
                  <span style={{ fontSize: '14px', fontWeight: '700', color: cfg.color, minWidth: '32px', textAlign: 'right' }}>{count}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* AI Recommendations */}
      <div style={{ ...S.card, marginTop: '16px', background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)', border: '1px solid #3B82F650' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>🤖</span>
            <div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#3B82F6' }}>AI Agent Recommendations</div>
              <div style={{ fontSize: '11px', color: '#64748B' }}>Top 10 investors to prioritize today</div>
            </div>
          </div>
          <div style={{ fontSize: '10px', color: '#10B981', background: '#10B98120', padding: '4px 10px', borderRadius: '12px' }}>
            Updated just now
          </div>
        </div>
        
        <div style={{ display: 'grid', gap: '8px' }}>
          {getAIPrioritizedInvestors(investors).map((inv, idx) => (
            <div 
              key={inv.id}
              onClick={() => { setSelectedId(inv.id); setView('pipeline'); }}
              style={{ 
                display: 'grid', 
                gridTemplateColumns: '32px 1fr auto',
                gap: '12px',
                padding: '12px',
                background: idx === 0 ? '#3B82F615' : '#ffffff05',
                borderRadius: '8px',
                cursor: 'pointer',
                border: idx === 0 ? '1px solid #3B82F640' : '1px solid transparent',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#3B82F620'; e.currentTarget.style.borderColor = '#3B82F6'; }}
              onMouseLeave={e => { e.currentTarget.style.background = idx === 0 ? '#3B82F615' : '#ffffff05'; e.currentTarget.style.borderColor = idx === 0 ? '#3B82F640' : 'transparent'; }}
            >
              <div style={{ 
                width: '32px', 
                height: '32px', 
                borderRadius: '50%', 
                background: idx === 0 ? '#3B82F6' : idx < 3 ? '#10B981' : '#64748B',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: '700',
                color: '#FFF',
              }}>
                {idx + 1}
              </div>
              
              <div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: '#FFFFFF' }}>{inv.name}</div>
                <div style={{ fontSize: '12px', color: '#A0AEC0' }}>{inv.company || INVESTOR_TYPES[inv.type]?.label}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                  {inv.aiReasons.map((reason, i) => (
                    <span key={i} style={{ fontSize: '10px', color: '#94A3B8', background: '#1E293B', padding: '2px 8px', borderRadius: '4px' }}>
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
              
              <div style={{ textAlign: 'right' }}>
                <div style={{ 
                  fontSize: '18px', 
                  fontWeight: '800', 
                  color: inv.aiScore >= 60 ? '#10B981' : inv.aiScore >= 40 ? '#F59E0B' : '#64748B',
                }}>
                  {inv.aiScore}
                </div>
                <div style={{ fontSize: '9px', color: '#64748B', marginTop: '2px' }}>AI SCORE</div>
                <div style={{ fontSize: '11px', color: '#3B82F6', marginTop: '8px', maxWidth: '140px' }}>{inv.aiAction}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// INVESTOR DETAIL PANEL
// ═══════════════════════════════════════════════════════════════

function InvestorDetail({ investor, setInvestors, onClose }) {
  const [form, setForm] = useState({ ...investor });
  const [editing, setEditing] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [researching, setResearching] = useState(false);
  const [researchResult, setResearchResult] = useState(null);

  useEffect(() => { setForm({ ...investor }); setEditing(false); setResearchResult(null); }, [investor.id]);

  const save = () => {
    setInvestors(prev => prev.map(i => i.id === investor.id ? { ...form } : i));
    setEditing(false);
  };

  const addActivity = (type) => {
    const activity = { type, date: new Date().toISOString(), note: newNote };
    const updated = { ...form, activities: [...(form.activities || []), activity], lastContact: new Date().toISOString() };
    setForm(updated);
    setInvestors(prev => prev.map(i => i.id === investor.id ? updated : i));
    setNewNote('');
  };

  const findContact = async () => {
    setResearching(true);
    setResearchResult(null);
    try {
      const res = await fetch('/api/apollo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: investor.company || investor.name, type: investor.type }),
      });
      const data = await res.json();
      setResearchResult(data);
      
      if (data.success && data.contact?.email) {
        // Auto-update the form with found contact
        const updated = { 
          ...form, 
          email: data.contact.email,
          notes: form.notes ? `${form.notes}\n\nFound via Apollo: ${data.contact.name} - ${data.contact.title}` : `Found via Apollo: ${data.contact.name} - ${data.contact.title}`,
        };
        setForm(updated);
        setEditing(true);
      }
    } catch (err) {
      setResearchResult({ error: err.message });
    }
    setResearching(false);
  };

  const openLinkedInSearch = () => {
    const query = encodeURIComponent(`${investor.company || investor.name} partner venture crypto`);
    window.open(`https://www.linkedin.com/search/results/people/?keywords=${query}`, '_blank');
  };

  const openGoogleSearch = () => {
    const query = encodeURIComponent(`"${investor.company || investor.name}" partner email crypto venture`);
    window.open(`https://www.google.com/search?q=${query}`, '_blank');
  };

  const score = calculateEngagementScore(investor);
  const urgency = getOutreachUrgency(investor);
  const angle = PITCH_ANGLES[investor.pitchAngle];

  return (
    <div style={{ width: '380px', background: '#111318', border: '1px solid #1E293B', borderRadius: '10px', overflowY: 'auto', flexShrink: 0 }}>
      <div style={{ padding: '20px', borderBottom: '1px solid #2D3748', display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: '700', color: '#FFFFFF' }}>{investor.name}</div>
          {investor.company && investor.company !== investor.name && <div style={{ fontSize: '14px', color: '#A0AEC0', marginTop: '4px' }}>{investor.company}</div>}
          {form.email ? (
            <div style={{ fontSize: '14px', color: '#3B82F6', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📧 {form.email}
              <button 
                onClick={() => { setForm(p => ({ ...p, email: '' })); setEditing(true); }}
                style={{ fontSize: '10px', color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
              >
                change
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '10px' }}>
              <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                <input 
                  type="email"
                  placeholder="Add email manually..."
                  value={form.email || ''}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && form.email) save(); }}
                  style={{ ...S.input, flex: 1, fontSize: '12px', padding: '8px 10px' }}
                />
                <button 
                  onClick={save}
                  disabled={!form.email}
                  style={{ ...S.btn('primary'), fontSize: '12px', padding: '6px 12px', opacity: form.email ? 1 : 0.5 }}
                >
                  Save
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button 
                  onClick={findContact} 
                  disabled={researching}
                  style={{ ...S.btn(), fontSize: '11px', padding: '5px 10px', opacity: researching ? 0.6 : 1, background: '#1D4ED820', border: '1px solid #1D4ED8' }}
                >
                  {researching ? '🔍 Searching...' : '🔍 Apollo'}
                </button>
                <button onClick={openLinkedInSearch} style={{ ...S.btn(), fontSize: '11px', padding: '5px 10px' }}>LinkedIn</button>
                <button onClick={openGoogleSearch} style={{ ...S.btn(), fontSize: '11px', padding: '5px 10px' }}>Google</button>
              </div>
            </div>
          )}
        </div>
        <button onClick={onClose} style={{ ...S.btn(), padding: '6px 10px', fontSize: '16px' }}>✕</button>
      </div>

      {/* Research Results */}
      {researchResult && (
        <div style={{ padding: '16px', borderBottom: '1px solid #2D3748', background: researchResult.success ? '#10B98115' : '#EF444415' }}>
          {researchResult.success ? (
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#10B981', marginBottom: '8px' }}>
                {researchResult.hasEmail ? '✅ Contact Found with Email!' : '✅ Contact Found (no email on free tier)'}
              </div>
              <div style={{ fontSize: '14px', color: '#FFFFFF', fontWeight: '600' }}>{researchResult.contact.name}</div>
              <div style={{ fontSize: '13px', color: '#A0AEC0' }}>{researchResult.contact.title}</div>
              {researchResult.contact.email ? (
                <div style={{ fontSize: '14px', color: '#3B82F6', marginTop: '6px', fontWeight: '500' }}>
                  📧 {researchResult.contact.email}
                  <button onClick={() => navigator.clipboard.writeText(researchResult.contact.email)} style={{ ...S.btn(), marginLeft: '8px', padding: '2px 8px', fontSize: '11px' }}>Copy</button>
                </div>
              ) : researchResult.contact.linkedin ? (
                <a href={researchResult.contact.linkedin} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '8px', padding: '8px 14px', background: '#0A66C2', color: '#FFF', borderRadius: '6px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>
                  🔗 Message on LinkedIn
                </a>
              ) : null}
              {researchResult.note && <div style={{ fontSize: '11px', color: '#F59E0B', marginTop: '8px', padding: '6px', background: '#F59E0B15', borderRadius: '4px' }}>💡 {researchResult.note}</div>}
              {researchResult.alternatives?.length > 1 && (
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #2D3748' }}>
                  <div style={{ fontSize: '11px', color: '#718096', marginBottom: '6px' }}>OTHER CONTACTS:</div>
                  {researchResult.alternatives.slice(1).map((alt, i) => (
                    <div key={i} style={{ fontSize: '12px', color: '#A0AEC0', padding: '4px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>{alt.name} - {alt.title}</span>
                      {alt.email && <span style={{ color: '#3B82F6' }}>{alt.email}</span>}
                      {alt.linkedin && <a href={alt.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: '#0A66C2', fontSize: '11px' }}>LinkedIn</a>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: '#EF4444', marginBottom: '6px' }}>❌ {researchResult.error}</div>
              {researchResult.setup_url && (
                <a href={researchResult.setup_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#3B82F6' }}>Get Apollo API Key →</a>
              )}
              {researchResult.suggestion && <div style={{ fontSize: '12px', color: '#A0AEC0', marginTop: '4px' }}>{researchResult.suggestion}</div>}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: '16px' }}>
        {/* Score & Urgency */}
        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
          <div style={{ flex: 1, background: '#0A0A0F', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: '800', color: score > 60 ? '#10B981' : score > 30 ? '#F59E0B' : '#64748B' }}>{score}</div>
            <div style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px' }}>ENGAGEMENT</div>
          </div>
          {urgency && (
            <div style={{ flex: 1, background: '#0A0A0F', borderRadius: '8px', padding: '12px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: urgency.color }}>{urgency.label}</div>
              <div style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', marginTop: '4px' }}>STATUS</div>
            </div>
          )}
        </div>

        {/* Editable Fields */}
        <div style={{ display: 'grid', gap: '10px', marginBottom: '16px' }}>
          {[
            { key: 'stage', label: 'STAGE', el: 'select', opts: PIPELINE_STAGES },
            { key: 'priority', label: 'PRIORITY', el: 'select', opts: { high: { label: '🔴 High' }, medium: { label: '🟡 Medium' }, low: { label: '⚪ Low' } } },
            { key: 'pitchAngle', label: 'PITCH ANGLE', el: 'select', opts: PITCH_ANGLES },
          ].map(f => (
            <div key={f.key}>
              <label style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700' }}>{f.label}</label>
              <select style={{ ...S.select, width: '100%', marginTop: '4px' }} value={form[f.key]} onChange={e => { setForm(p => ({ ...p, [f.key]: e.target.value })); setEditing(true); }}>
                {Object.entries(f.opts).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          ))}
          <div>
            <label style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700' }}>NEXT ACTION</label>
            <input style={{ ...S.input, marginTop: '4px' }} value={form.nextAction || ''} onChange={e => { setForm(p => ({ ...p, nextAction: e.target.value })); setEditing(true); }} />
          </div>
          <div>
            <label style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700' }}>COMMITMENT ($)</label>
            <input style={{ ...S.input, marginTop: '4px' }} type="number" value={form.commitment || ''} onChange={e => { setForm(p => ({ ...p, commitment: parseInt(e.target.value) || 0 })); setEditing(true); }} />
          </div>
          <div>
            <label style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700' }}>NOTES</label>
            <textarea style={{ ...S.input, marginTop: '4px', minHeight: '60px', resize: 'vertical' }} value={form.notes || ''} onChange={e => { setForm(p => ({ ...p, notes: e.target.value })); setEditing(true); }} />
          </div>
        </div>

        {editing && <button style={{ ...S.btn('primary'), width: '100%', marginBottom: '16px' }} onClick={save}>Save Changes</button>}

        {/* Pitch Recommendation */}
        {angle && (
          <div style={{ background: '#0A0A0F', borderRadius: '8px', padding: '12px', marginBottom: '16px', border: '1px solid #1E293B' }}>
            <div style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700', marginBottom: '6px' }}>RECOMMENDED PITCH</div>
            <div style={{ fontSize: '13px', fontWeight: '700', color: '#F8FAFC', marginBottom: '4px' }}>{angle.label}</div>
            <div style={{ fontSize: '11px', color: '#94A3B8', marginBottom: '8px' }}>{angle.description}</div>
            {angle.talkingPoints.map((tp, idx) => (
              <div key={idx} style={{ fontSize: '11px', color: '#CBD5E1', padding: '2px 0' }}>→ {tp}</div>
            ))}
            <div style={{ fontSize: '9px', color: '#64748B', marginTop: '8px' }}>Key slides: {angle.keySlides.join(', ')}</div>
          </div>
        )}

        {/* Log Activity */}
        <div style={{ borderTop: '1px solid #1E293B', paddingTop: '12px' }}>
          <div style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700', marginBottom: '8px' }}>LOG ACTIVITY</div>
          <input style={{ ...S.input, marginBottom: '8px' }} placeholder="Add a note..." value={newNote} onChange={e => setNewNote(e.target.value)} />
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {['📧 Email', '📞 Call', '🤝 Meeting', '📝 Note', '📨 Follow-up'].map(t => (
              <button key={t} style={{ ...S.btn(), padding: '4px 8px', fontSize: '10px' }} onClick={() => addActivity(t)}>{t}</button>
            ))}
          </div>
          {investor.activities?.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              {[...investor.activities].reverse().slice(0, 5).map((a, idx) => (
                <div key={idx} style={{ padding: '6px 0', borderBottom: '1px solid rgba(30,41,59,0.1)', fontSize: '11px' }}>
                  <span style={{ color: '#94A3B8' }}>{a.type}</span>
                  {a.note && <span style={{ color: '#64748B' }}> — {a.note}</span>}
                  <div style={{ fontSize: '9px', color: '#475569', marginTop: '2px' }}>{new Date(a.date).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PIPELINE VIEW
// ═══════════════════════════════════════════════════════════════

function PipelineView({ investors, setInvestors, selectedId, setSelectedId, filters, setFilters }) {
  const filtered = useMemo(() => {
    let r = [...investors];
    if (filters.search) { const q = filters.search.toLowerCase(); r = r.filter(i => [i.name, i.company, i.email, i.notes].some(f => (f || '').toLowerCase().includes(q))); }
    if (filters.type !== 'all') r = r.filter(i => i.type === filters.type);
    if (filters.stage !== 'all') r = r.filter(i => i.stage === filters.stage);
    if (filters.priority !== 'all') r = r.filter(i => i.priority === filters.priority);
    if (filters.source !== 'all') r = r.filter(i => i.source === filters.source);
    r.sort((a, b) => {
      if (filters.sort === 'engagement') return calculateEngagementScore(b) - calculateEngagementScore(a);
      if (filters.sort === 'commitment') return (b.commitment || 0) - (a.commitment || 0);
      if (filters.sort === 'stage') return (PIPELINE_STAGES[a.stage]?.order || 0) - (PIPELINE_STAGES[b.stage]?.order || 0);
      return (a.name || '').localeCompare(b.name || '');
    });
    return r;
  }, [investors, filters]);

  const selected = selectedId ? investors.find(i => i.id === selectedId) : null;

  return (
    <div style={{ display: 'flex', gap: '16px', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ ...S.input, width: '240px' }} placeholder="Search name, company, notes..." value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
          <select style={S.select} value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
            <option value="all">All Types</option>
            {Object.entries(INVESTOR_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
          <select style={S.select} value={filters.stage} onChange={e => setFilters(f => ({ ...f, stage: e.target.value }))}>
            <option value="all">All Stages</option>
            {Object.entries(PIPELINE_STAGES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select style={S.select} value={filters.priority} onChange={e => setFilters(f => ({ ...f, priority: e.target.value }))}>
            <option value="all">All Priority</option>
            <option value="high">🔴 High</option>
            <option value="medium">🟡 Medium</option>
            <option value="low">⚪ Low</option>
          </select>
          <select style={S.select} value={filters.source} onChange={e => setFilters(f => ({ ...f, source: e.target.value }))}>
            <option value="all">All Sources</option>
            <option value="angel-list">Angel List</option>
            <option value="sui-ecosystem">Sui Ecosystem</option>
            <option value="direct-contacts">Direct Contacts</option>
            <option value="enhanced-database">Enhanced DB</option>
            <option value="inception-funds">Inception Funds</option>
            <option value="web3-vc-list">Web3 VCs</option>
            <option value="manual">Manual</option>
          </select>
          <select style={S.select} value={filters.sort} onChange={e => setFilters(f => ({ ...f, sort: e.target.value }))}>
            <option value="name">Sort: Name</option>
            <option value="engagement">Sort: Engagement</option>
            <option value="commitment">Sort: Commitment</option>
            <option value="stage">Sort: Stage</option>
          </select>
          <span style={{ fontSize: '11px', color: '#64748B' }}>{filtered.length} results</span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={S.th}>Name / Company</th>
              <th style={S.th}>Type</th>
              <th style={S.th}>Stage</th>
              <th style={S.th}>Priority</th>
              <th style={S.th}>Pitch</th>
              <th style={S.th}>Score</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 150).map(i => {
              const tc = INVESTOR_TYPES[i.type] || INVESTOR_TYPES.other;
              const sc = PIPELINE_STAGES[i.stage] || PIPELINE_STAGES.identified;
              const score = calculateEngagementScore(i);
              return (
                <tr key={i.id} style={{ cursor: 'pointer', background: selectedId === i.id ? 'rgba(30,41,59,0.3)' : 'transparent' }} onClick={() => setSelectedId(i.id)}>
                  <td style={S.td}>
                    <div style={{ fontWeight: '600', color: '#F8FAFC' }}>{i.name}</div>
                    {i.company && i.company !== i.name && <div style={{ fontSize: '10px', color: '#64748B' }}>{i.company}</div>}
                  </td>
                  <td style={S.td}><span style={S.badge(tc.color)}>{tc.icon} {tc.label}</span></td>
                  <td style={S.td}><span style={S.badge(sc.color)}>{sc.label}</span></td>
                  <td style={S.td}><span style={{ color: i.priority === 'high' ? '#EF4444' : i.priority === 'medium' ? '#F59E0B' : '#64748B', fontWeight: '700', fontSize: '11px' }}>{i.priority === 'high' ? '●' : '○'} {(i.priority || '').toUpperCase()}</span></td>
                  <td style={S.td}><span style={{ fontSize: '10px', color: '#94A3B8' }}>{PITCH_ANGLES[i.pitchAngle]?.label || '—'}</span></td>
                  <td style={S.td}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '50%', border: `2px solid ${score > 60 ? '#10B981' : score > 30 ? '#F59E0B' : '#64748B'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: '800', color: score > 60 ? '#10B981' : score > 30 ? '#F59E0B' : '#64748B' }}>{score}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > 150 && <div style={{ padding: '12px', textAlign: 'center', color: '#64748B', fontSize: '11px' }}>Showing 150 of {filtered.length} — use filters to narrow</div>}
      </div>
      {selected && <InvestorDetail investor={selected} setInvestors={setInvestors} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OUTREACH INTELLIGENCE
// ═══════════════════════════════════════════════════════════════

function OutreachView({ investors, setView, setSelectedId }) {
  const recs = useMemo(() => generateRecommendations(investors), [investors]);
  return (
    <div>
      <div style={{ ...S.card, background: 'linear-gradient(135deg, #111318, #1A1A2E)', border: '1px solid rgba(59,130,246,0.25)' }}>
        <div style={S.cardTitle}>🧠 Outreach Intelligence Engine</div>
        <div style={{ fontSize: '12px', color: '#94A3B8', lineHeight: '1.6' }}>
          Prioritized outreach recommendations based on {investors.length} contacts. <strong style={{ color: '#3B82F6' }}>Click any investor to edit their profile.</strong>
        </div>
      </div>
      {recs.map((rec, idx) => (
        <div key={idx} style={S.card}>
          <div style={{ ...S.cardTitle, fontSize: '14px' }}>{rec.category}</div>
          <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '12px' }}>{rec.action}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={S.th}>Investor</th><th style={S.th}>Type</th><th style={S.th}>Pitch</th><th style={S.th}>Action</th></tr></thead>
            <tbody>
              {rec.investors.map(i => (
                <tr 
                  key={i.id}
                  onClick={() => { setSelectedId(i.id); setView('pipeline'); }}
                  style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(59,130,246,0.1)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={S.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#3B82F6' }}>→</span>
                      <div>
                        <div style={{ fontWeight: '600', color: '#F8FAFC' }}>{i.name}</div>
                        {i.company && i.company !== i.name && <div style={{ fontSize: '10px', color: '#64748B' }}>{i.company}</div>}
                      </div>
                    </div>
                  </td>
                  <td style={S.td}><span style={S.badge((INVESTOR_TYPES[i.type] || INVESTOR_TYPES.other).color)}>{(INVESTOR_TYPES[i.type] || INVESTOR_TYPES.other).label}</span></td>
                  <td style={S.td}><span style={{ fontSize: '11px', color: '#CBD5E1' }}>{PITCH_ANGLES[i.pitchAngle]?.label || '—'}</span></td>
                  <td style={S.td}><span style={{ fontSize: '10px', color: '#F59E0B' }}>{i.nextAction || 'Edit profile →'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// PITCH PLAYBOOK
// ═══════════════════════════════════════════════════════════════

function PlaybookView({ investors }) {
  return (
    <div>
      <div style={{ ...S.card, background: 'linear-gradient(135deg, #111318, #1A1A2E)', border: '1px solid rgba(139,92,246,0.25)' }}>
        <div style={S.cardTitle}>📖 Pitch Playbook</div>
        <div style={{ fontSize: '12px', color: '#94A3B8', lineHeight: '1.6' }}>Five pitch angles mapped to your deck slides and investor types.</div>
      </div>
      {Object.entries(PITCH_ANGLES).map(([key, angle]) => {
        const count = investors.filter(i => i.pitchAngle === key).length;
        return (
          <div key={key} style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <div>
                <div style={{ fontSize: '16px', fontWeight: '700', color: '#F8FAFC' }}>{angle.label}</div>
                <div style={{ fontSize: '12px', color: '#94A3B8', marginTop: '4px' }}>{angle.description}</div>
              </div>
              <span style={S.badge('#3B82F6')}>{count} investors</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700', marginBottom: '8px' }}>BEST FOR</div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {angle.bestFor.map(t => INVESTOR_TYPES[t]).filter(Boolean).map((t, i) => <span key={i} style={S.badge(t.color)}>{t.icon} {t.label}</span>)}
                </div>
                <div style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700', marginBottom: '4px', marginTop: '16px' }}>KEY SLIDES</div>
                <div style={{ fontSize: '12px', color: '#CBD5E1' }}>Slides {angle.keySlides.join(', ')}</div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700', marginBottom: '8px' }}>TALKING POINTS</div>
                {angle.talkingPoints.map((tp, i) => <div key={i} style={{ fontSize: '11px', color: '#CBD5E1', padding: '3px 0' }}><span style={{ color: '#10B981' }}>→</span> {tp}</div>)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ADD INVESTOR MODAL
// ═══════════════════════════════════════════════════════════════

function AddInvestorForm({ onAdd, onClose }) {
  const [form, setForm] = useState({ name: '', company: '', email: '', type: 'other', priority: 'medium', stage: 'identified', notes: '', pitchAngle: 'neutral-auction' });
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ ...S.card, width: '480px', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={S.cardTitle}>Add Investor</div>
          <button onClick={onClose} style={{ ...S.btn(), padding: '4px 8px' }}>✕</button>
        </div>
        <div style={{ display: 'grid', gap: '10px' }}>
          {['name', 'company', 'email'].map(k => (
            <div key={k}>
              <label style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700' }}>{k.toUpperCase()}</label>
              <input style={{ ...S.input, marginTop: '4px' }} value={form[k]} onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))} />
            </div>
          ))}
          {[
            { key: 'type', opts: INVESTOR_TYPES },
            { key: 'stage', opts: PIPELINE_STAGES },
            { key: 'pitchAngle', opts: PITCH_ANGLES },
          ].map(f => (
            <div key={f.key}>
              <label style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700' }}>{f.key.toUpperCase()}</label>
              <select style={{ ...S.select, width: '100%', marginTop: '4px' }} value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}>
                {Object.entries(f.opts).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          ))}
          <div>
            <label style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700' }}>NOTES</label>
            <textarea style={{ ...S.input, marginTop: '4px', minHeight: '60px' }} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
          <button style={{ ...S.btn('primary'), width: '100%', marginTop: '8px' }} onClick={() => { if (form.name) { onAdd(form); onClose(); } }}>Add to Pipeline</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════

export default function Home() {
  const { data: session, status } = useSession();
  const [investors, setInvestors] = useState([]);
  const [view, setView] = useState('dashboard');
  const [selectedId, setSelectedId] = useState(null);
  const [filters, setFilters] = useState({ search: '', type: 'all', stage: 'all', source: 'all', priority: 'all', sort: 'name' });
  const [showAdd, setShowAdd] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);

  // Auto Gmail sync - runs every hour
  useEffect(() => {
    if (!session?.accessToken || !autoSyncEnabled || !loaded) return;
    
    // Check if we should sync (last sync > 1 hour ago or never synced)
    const lastSyncTime = localStorage.getItem('birdai-last-gmail-sync');
    const oneHour = 60 * 60 * 1000;
    const shouldSync = !lastSyncTime || (Date.now() - parseInt(lastSyncTime)) > oneHour;
    
    if (shouldSync) {
      console.log('🔄 Auto-syncing Gmail...');
      syncGmail(true); // silent mode
    }
    
    // Set up interval to check every 5 minutes if sync is needed
    const interval = setInterval(() => {
      const last = localStorage.getItem('birdai-last-gmail-sync');
      if (!last || (Date.now() - parseInt(last)) > oneHour) {
        console.log('🔄 Auto-syncing Gmail (hourly)...');
        syncGmail(true);
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
    
    return () => clearInterval(interval);
  }, [session, autoSyncEnabled, loaded]);

  // Gmail sync function (silent = no alerts, for auto-sync)
  const syncGmail = async (silent = false) => {
    if (!session?.accessToken) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/gmail/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.accessToken, investors }),
      });
      const data = await res.json();
      
      // Save sync time
      localStorage.setItem('birdai-last-gmail-sync', Date.now().toString());
      
      if (data.success && data.matches?.length > 0) {
        // Update investors with email matches
        setInvestors(prev => prev.map(inv => {
          const match = data.matches.find(m => m.investorId === inv.id);
          if (match) {
            const newActivity = { type: 'email', note: `Email sent: "${match.subject}"`, date: match.timestamp };
            return {
              ...inv,
              email: inv.email || match.email,
              lastContact: match.timestamp,
              activities: [...(inv.activities || []), newActivity],
            };
          }
          return inv;
        }));
        setLastSync({ time: new Date().toISOString(), matches: data.matches.length, scanned: data.scanned });
        if (!silent) {
          alert(`✅ Gmail synced! Found ${data.matches.length} matches from ${data.scanned} sent emails.`);
        } else {
          console.log(`✅ Auto-sync: Found ${data.matches.length} matches from ${data.scanned} emails`);
        }
      } else {
        setLastSync({ time: new Date().toISOString(), matches: 0, scanned: data.scanned || 0 });
        if (!silent) {
          alert(data.message || 'No new matches found in your sent emails.');
        }
      }
    } catch (err) {
      console.error('Gmail sync error:', err);
      if (!silent) {
        alert('Error syncing Gmail. Check console for details.');
      }
    }
    setSyncing(false);
  };

  // Load
  useEffect(() => {
    const stored = loadInvestors();
    setInvestors(stored || buildInitialInvestors());
    setLoaded(true);
  }, []);

  // Save on change
  useEffect(() => {
    if (loaded && investors.length > 0) {
      const t = setTimeout(() => saveInvestors(investors), 500);
      return () => clearTimeout(t);
    }
  }, [investors, loaded]);

  const addInvestor = (form) => {
    const maxId = investors.reduce((max, i) => Math.max(max, i.id), 0);
    setInvestors(prev => [...prev, { ...form, id: maxId + 1, commitment: 0, website: '', twitter: '', location: '', focus: '', aum: '', source: 'manual', lastContact: null, nextAction: '', activities: [] }]);
  };

  if (!loaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0A0A0F' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#F8FAFC' }}>BIRDAI</div>
          <div style={{ fontSize: '12px', color: '#64748B' }}>Loading pipeline...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Header */}
      <header style={{ background: 'linear-gradient(135deg, #0F1419, #1A1A2E)', borderBottom: '1px solid #2D3748', padding: '18px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '40px', height: '40px', background: 'linear-gradient(135deg, #10B981, #3B82F6)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '18px', color: '#000' }}>B</div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: '700', letterSpacing: '2px', color: '#FFFFFF' }}>BIRDAI</div>
            <div style={{ fontSize: '12px', color: '#A0AEC0', letterSpacing: '0.5px' }}>FUNDRAISING COMMAND CENTER</div>
          </div>
        </div>
        <nav style={{ display: 'flex', gap: '4px', background: '#13151A', borderRadius: '10px', padding: '4px' }}>
          {[{ k: 'dashboard', l: 'Dashboard' }, { k: 'pipeline', l: 'Pipeline' }, { k: 'outreach', l: 'Outreach Intel' }, { k: 'playbook', l: 'Pitch Playbook' }].map(t => (
            <button key={t.k} onClick={() => setView(t.k)} style={{ padding: '10px 20px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit', background: view === t.k ? '#2D3748' : 'transparent', color: view === t.k ? '#FFFFFF' : '#A0AEC0' }}>{t.l}</button>
          ))}
        </nav>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {/* Gmail Integration */}
          {session ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button 
                  style={{ ...S.btn(), background: syncing ? '#374151' : '#1D4ED8', color: '#FFF', fontSize: '12px', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px' }} 
                  onClick={() => syncGmail(false)} 
                  disabled={syncing}
                >
                  {syncing ? '🔄 Syncing...' : '📧 Sync Now'}
                </button>
                <button
                  onClick={() => setAutoSyncEnabled(!autoSyncEnabled)}
                  style={{ 
                    padding: '6px 10px', 
                    fontSize: '10px', 
                    background: autoSyncEnabled ? '#10B98130' : '#37415150', 
                    color: autoSyncEnabled ? '#10B981' : '#64748B',
                    border: `1px solid ${autoSyncEnabled ? '#10B981' : '#374151'}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    fontWeight: '600',
                  }}
                  title={autoSyncEnabled ? 'Auto-sync is ON (every hour)' : 'Auto-sync is OFF'}
                >
                  {autoSyncEnabled ? '⚡ AUTO' : '⏸ AUTO'}
                </button>
              </div>
              <div style={{ fontSize: '9px', color: '#64748B', textAlign: 'right', lineHeight: '1.3' }}>
                <div>{session.user?.email?.split('@')[0]}</div>
                {lastSync && <div style={{ color: '#10B981' }}>Last: {new Date(lastSync.time).toLocaleTimeString()}</div>}
              </div>
              <button style={{ fontSize: '12px', color: '#94A3B8', background: 'none', border: 'none', cursor: 'pointer', padding: '4px' }} onClick={() => signOut()}>✕</button>
            </div>
          ) : (
            <button 
              style={{ ...S.btn(), background: '#DC2626', color: '#FFF', fontSize: '12px', padding: '8px 14px' }} 
              onClick={() => signIn('google')}
              disabled={status === 'loading'}
            >
              📧 Connect Gmail
            </button>
          )}
          <button style={S.btn('primary')} onClick={() => setShowAdd(true)}>+ Add Investor</button>
          <button 
            style={{ ...S.btn(), fontSize: '11px', padding: '8px 12px' }} 
            onClick={() => {
              const data = JSON.stringify(investors, null, 2);
              const blob = new Blob([data], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `birdai-investors-${new Date().toISOString().split('T')[0]}.json`;
              a.click();
            }}
          >
            📤 Export
          </button>
          <button 
            style={{ ...S.btn(), fontSize: '11px', padding: '8px 12px' }} 
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.json';
              input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    try {
                      const imported = JSON.parse(ev.target.result);
                      if (Array.isArray(imported) && imported.length > 0) {
                        if (confirm(`Import ${imported.length} investors? This will replace your current data.`)) {
                          setInvestors(imported);
                          localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
                          alert(`✅ Imported ${imported.length} investors!`);
                        }
                      } else {
                        alert('Invalid file format');
                      }
                    } catch (err) {
                      alert('Error parsing file: ' + err.message);
                    }
                  };
                  reader.readAsText(file);
                }
              };
              input.click();
            }}
          >
            📥 Import
          </button>
          <button style={{ ...S.btn(), fontSize: '11px', padding: '8px 12px' }} onClick={() => { if (confirm('Reset all data?')) { setInvestors(buildInitialInvestors()); localStorage.removeItem(STORAGE_KEY); } }}>Reset</button>
        </div>
      </header>

      <main style={{ padding: '24px', overflowY: 'auto', height: 'calc(100vh - 65px)' }}>
        {view === 'dashboard' && <Dashboard investors={investors} setView={setView} setSelectedId={setSelectedId} setFilters={setFilters} />}
        {view === 'pipeline' && <PipelineView investors={investors} setInvestors={setInvestors} selectedId={selectedId} setSelectedId={setSelectedId} filters={filters} setFilters={setFilters} />}
        {view === 'outreach' && <OutreachView investors={investors} setView={setView} setSelectedId={setSelectedId} />}
        {view === 'playbook' && <PlaybookView investors={investors} />}
      </main>

      {showAdd && <AddInvestorForm onAdd={addInvestor} onClose={() => setShowAdd(false)} />}
    </div>
  );
}
