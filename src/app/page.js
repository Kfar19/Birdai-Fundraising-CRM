'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { INVESTOR_TYPES, PIPELINE_STAGES, PITCH_ANGLES } from '../lib/constants';
import { calculateEngagementScore, getOutreachUrgency, generateRecommendations, suggestPitchAngle, getAIPrioritizedInvestors } from '../lib/engine';
import { buildInitialInvestors } from '../data/investors';
import { supabase, fetchInvestors, bulkUpsertInvestors, subscribeToChanges, unsubscribeFromChanges, fromDbFormat, deleteInvestor } from '../lib/supabase';

// ═══════════════════════════════════════════════════════════════
// STORAGE — uses localStorage + Supabase for persistence
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
  card: { 
    background: 'linear-gradient(145deg, #181922 0%, #14151F 100%)', 
    border: '1px solid #2A2D3E', 
    borderRadius: '16px', 
    padding: '28px', 
    marginBottom: '20px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.2)'
  },
  cardTitle: { 
    fontSize: '14px', 
    fontWeight: '700', 
    color: '#9BA3B5', 
    marginBottom: '18px', 
    letterSpacing: '1.5px', 
    textTransform: 'uppercase' 
  },
  badge: (color) => ({ 
    display: 'inline-block', 
    padding: '6px 12px', 
    borderRadius: '8px', 
    fontSize: '13px', 
    fontWeight: '600', 
    background: color + '18', 
    color, 
    letterSpacing: '0.2px',
    border: `1px solid ${color}30`
  }),
  input: { 
    width: '100%', 
    padding: '12px 16px', 
    background: '#0C0C12', 
    border: '1px solid #2A2D3E', 
    borderRadius: '10px', 
    color: '#E8EAF0', 
    fontSize: '15px', 
    fontFamily: 'inherit', 
    outline: 'none', 
    boxSizing: 'border-box',
    transition: 'border-color 0.2s, box-shadow 0.2s'
  },
  select: { 
    padding: '12px 16px', 
    background: '#0C0C12', 
    border: '1px solid #2A2D3E', 
    borderRadius: '10px', 
    color: '#E8EAF0', 
    fontSize: '14px', 
    fontFamily: 'inherit', 
    outline: 'none',
    cursor: 'pointer'
  },
  btn: (v = 'default') => ({ 
    padding: '12px 24px', 
    borderRadius: '10px', 
    border: 'none', 
    cursor: 'pointer', 
    fontSize: '14px', 
    fontWeight: '600', 
    fontFamily: 'inherit', 
    background: v === 'primary' ? 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)' : v === 'danger' ? '#F87171' : '#2A2D3E', 
    color: v === 'primary' ? '#000' : '#E8EAF0', 
    transition: 'all 0.2s',
    boxShadow: v === 'primary' ? '0 4px 14px rgba(34,197,94,0.3)' : 'none'
  }),
  th: { 
    textAlign: 'left', 
    padding: '16px 18px', 
    fontSize: '12px', 
    fontWeight: '700', 
    color: '#9BA3B5', 
    letterSpacing: '1px', 
    textTransform: 'uppercase', 
    borderBottom: '2px solid #2A2D3E',
    background: '#14151F'
  },
  td: { 
    padding: '16px 18px', 
    fontSize: '15px', 
    borderBottom: '1px solid #1A1B28', 
    verticalAlign: 'middle', 
    color: '#E8EAF0',
    lineHeight: '1.5'
  },
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

  // Calculate yesterday's activity
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const endOfYesterday = new Date(yesterday);
  endOfYesterday.setHours(23, 59, 59, 999);
  
  const yesterdayActivity = useMemo(() => {
    const activities = [];
    let emailsLogged = 0;
    let callsLogged = 0;
    let meetingsLogged = 0;
    let notesAdded = 0;
    
    investors.forEach(inv => {
      if (inv.activities && inv.activities.length > 0) {
        inv.activities.forEach(act => {
          const actDate = new Date(act.date);
          if (actDate >= yesterday && actDate <= endOfYesterday) {
            activities.push({ ...act, investorName: inv.name, investorId: inv.id });
            if (act.type === 'email') emailsLogged++;
            if (act.type === 'call') callsLogged++;
            if (act.type === 'meeting') meetingsLogged++;
            if (act.type === 'note') notesAdded++;
          }
        });
      }
      // Check if lastContact was yesterday
      if (inv.lastContact) {
        const lastContactDate = new Date(inv.lastContact);
        if (lastContactDate >= yesterday && lastContactDate <= endOfYesterday) {
          if (!activities.find(a => a.investorId === inv.id)) {
            activities.push({ type: 'contact', date: inv.lastContact, investorName: inv.name, investorId: inv.id });
          }
        }
      }
    });
    
    return {
      activities: activities.sort((a, b) => new Date(b.date) - new Date(a.date)),
      emailsLogged,
      callsLogged,
      meetingsLogged,
      notesAdded,
      total: activities.length
    };
  }, [investors]);

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

      {/* Yesterday's Activity Summary */}
      <div style={{ ...S.card, marginTop: '16px', background: 'linear-gradient(135deg, #181922 0%, #1a1b28 100%)', border: '1px solid #22C55E40' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>📅</span>
            <div>
              <div style={{ fontSize: '16px', fontWeight: '700', color: '#22C55E' }}>Yesterday's Activity</div>
              <div style={{ fontSize: '11px', color: '#9BA3B5' }}>{yesterday.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
            </div>
          </div>
          <div style={{ fontSize: '12px', color: yesterdayActivity.total > 0 ? '#22C55E' : '#9BA3B5', background: yesterdayActivity.total > 0 ? '#22C55E20' : '#2A2D3E', padding: '6px 12px', borderRadius: '12px', fontWeight: '600' }}>
            {yesterdayActivity.total} {yesterdayActivity.total === 1 ? 'activity' : 'activities'}
          </div>
        </div>
        
        {/* Activity Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {[
            { icon: '📧', label: 'Emails', count: yesterdayActivity.emailsLogged, color: '#60A5FA' },
            { icon: '📞', label: 'Calls', count: yesterdayActivity.callsLogged, color: '#22C55E' },
            { icon: '🤝', label: 'Meetings', count: yesterdayActivity.meetingsLogged, color: '#F59E0B' },
            { icon: '📝', label: 'Notes', count: yesterdayActivity.notesAdded, color: '#A78BFA' },
          ].map((stat, idx) => (
            <div key={idx} style={{ background: '#0C0C12', borderRadius: '10px', padding: '14px', textAlign: 'center', border: `1px solid ${stat.color}30` }}>
              <div style={{ fontSize: '20px', marginBottom: '4px' }}>{stat.icon}</div>
              <div style={{ fontSize: '20px', fontWeight: '800', color: stat.color }}>{stat.count}</div>
              <div style={{ fontSize: '11px', color: '#9BA3B5' }}>{stat.label}</div>
            </div>
          ))}
        </div>
        
        {/* Activity Feed */}
        {yesterdayActivity.activities.length > 0 ? (
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {yesterdayActivity.activities.slice(0, 10).map((act, idx) => (
              <div 
                key={idx} 
                onClick={() => { setSelectedId(act.investorId); setView('pipeline'); }}
                style={{ 
                  padding: '10px 12px', 
                  background: '#0C0C12', 
                  borderRadius: '8px', 
                  marginBottom: '8px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px',
                  cursor: 'pointer',
                  border: '1px solid #2A2D3E',
                  transition: 'border-color 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = '#22C55E'}
                onMouseLeave={e => e.currentTarget.style.borderColor = '#2A2D3E'}
              >
                <span style={{ fontSize: '16px' }}>
                  {act.type === 'email' ? '📧' : act.type === 'call' ? '📞' : act.type === 'meeting' ? '🤝' : act.type === 'note' ? '📝' : '✓'}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', color: '#E8EAF0' }}>{act.investorName}</div>
                  <div style={{ fontSize: '11px', color: '#9BA3B5' }}>
                    {act.type.charAt(0).toUpperCase() + act.type.slice(1)}{act.note ? ` — ${act.note.substring(0, 50)}${act.note.length > 50 ? '...' : ''}` : ''}
                  </div>
                </div>
                <div style={{ fontSize: '10px', color: '#6B7280' }}>
                  {new Date(act.date).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px', color: '#6B7280' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>📭</div>
            <div style={{ fontSize: '14px' }}>No activity logged yesterday</div>
            <div style={{ fontSize: '12px', marginTop: '4px' }}>Log emails, calls, and meetings in investor profiles to track your progress!</div>
          </div>
        )}
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
  const [aiResearch, setAiResearch] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Auto-fetch AI research when investor changes
  useEffect(() => { 
    setForm({ ...investor }); 
    setEditing(false); 
    setResearchResult(null);
    
    // Auto-fetch AI outreach suggestions
    const fetchAiResearch = async () => {
      // Skip if already committed or passed
      if (['committed', 'passed'].includes(investor.stage)) {
        setAiResearch(null);
        return;
      }
      
      setAiLoading(true);
      try {
        const res = await fetch('/api/ai-research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ investor }),
        });
        const data = await res.json();
        if (data.success && data.research) {
          setAiResearch(data.research);
        } else if (data.fallback) {
          setAiResearch(data.fallback);
        }
      } catch (err) {
        console.error('AI research error:', err);
      }
      setAiLoading(false);
    };
    
    fetchAiResearch();
  }, [investor.id]);

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
    <div style={{ width: expanded ? '550px' : '420px', background: '#181922', border: '1px solid #2A2D3E', borderRadius: '14px', overflowY: 'auto', flexShrink: 0, transition: 'width 0.3s ease', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
      <div style={{ padding: '20px', borderBottom: '1px solid #2A2D3E', display: 'flex', justifyContent: 'space-between', background: '#14151F', borderRadius: '14px 14px 0 0' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '20px', fontWeight: '700', color: '#FFFFFF' }}>{investor.name}</div>
          {investor.company && investor.company !== investor.name && <div style={{ fontSize: '14px', color: '#A0AEC0', marginTop: '4px' }}>{investor.company}</div>}
          {investor.email && !editing ? (
            <div style={{ fontSize: '14px', color: '#3B82F6', marginTop: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              📧 {investor.email}
              <button 
                onClick={() => { setEditing(true); }}
                style={{ fontSize: '10px', color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
              >
                change
              </button>
            </div>
          ) : (
            <div style={{ marginTop: '16px', background: '#1E293B30', padding: '16px', borderRadius: '10px', border: '1px dashed #3B82F650' }}>
              <div style={{ fontSize: '12px', color: '#3B82F6', marginBottom: '12px', fontWeight: '600' }}>📧 ADD EMAIL</div>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                <input 
                  type="email"
                  placeholder="name@company.com"
                  value={form.email || ''}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && form.email && form.email.includes('@')) save(); }}
                  style={{ ...S.input, flex: 1, fontSize: '14px', padding: '12px 14px', background: '#0A0A0F' }}
                />
                <button 
                  onClick={save}
                  disabled={!form.email || !form.email.includes('@')}
                  style={{ ...S.btn('primary'), fontSize: '14px', padding: '10px 20px', opacity: form.email && form.email.includes('@') ? 1 : 0.5 }}
                >
                  Save
                </button>
              </div>
              <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '8px' }}>Or search online:</div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button 
                  onClick={findContact} 
                  disabled={researching}
                  style={{ ...S.btn(), fontSize: '12px', padding: '8px 14px', opacity: researching ? 0.6 : 1, background: '#1D4ED820', border: '1px solid #1D4ED8' }}
                >
                  {researching ? '🔍 Searching...' : '🔍 Apollo'}
                </button>
                <button onClick={openLinkedInSearch} style={{ ...S.btn(), fontSize: '12px', padding: '8px 14px' }}>LinkedIn</button>
                <button onClick={openGoogleSearch} style={{ ...S.btn(), fontSize: '12px', padding: '8px 14px' }}>Google</button>
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={async () => {
              // Extra protection for committed investors
              if (investor.stage === 'committed') {
                if (!confirm(`⚠️ ${investor.name} is COMMITTED! Are you absolutely sure you want to delete them? This will remove their commitment.`)) {
                  return;
                }
              }
              if (confirm(`Delete ${investor.name}? This cannot be undone.`)) {
                // Delete from local state
                setInvestors(prev => prev.filter(i => i.id !== investor.id));
                // Delete from Supabase
                await deleteInvestor(investor.id);
                onClose();
              }
            }} 
            style={{ ...S.btn(), padding: '6px 10px', fontSize: '12px', background: investor.stage === 'committed' ? '#22C55E20' : '#EF444420', color: investor.stage === 'committed' ? '#22C55E' : '#EF4444', border: `1px solid ${investor.stage === 'committed' ? '#22C55E40' : '#EF444440'}` }}
          >
            {investor.stage === 'committed' ? '✅ Committed' : '🗑️ Delete'}
          </button>
          <button 
            onClick={() => setExpanded(e => !e)} 
            style={{ ...S.btn(), padding: '6px 10px', fontSize: '14px', background: expanded ? '#60A5FA20' : 'transparent', border: '1px solid #2A2D3E' }}
            title={expanded ? 'Collapse panel' : 'Expand panel'}
          >
            {expanded ? '◀' : '▶'}
          </button>
          <button onClick={onClose} style={{ ...S.btn(), padding: '6px 10px', fontSize: '16px' }}>✕</button>
        </div>
      </div>

      {/* AI OUTREACH SUGGESTIONS - Most Important Section */}
      {aiLoading && (
        <div style={{ padding: '20px', background: 'linear-gradient(135deg, #3B82F610, #8B5CF610)', borderBottom: '1px solid #3B82F630' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ fontSize: '20px', animation: 'spin 1s linear infinite' }}>🤖</div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: '700', color: '#3B82F6' }}>AI Agent Researching...</div>
              <div style={{ fontSize: '12px', color: '#64748B' }}>Generating personalized outreach for {investor.name}</div>
            </div>
          </div>
        </div>
      )}
      
      {aiResearch && !aiLoading && !['committed', 'passed'].includes(form.stage) && (
        <div style={{ padding: '20px', background: 'linear-gradient(135deg, #10B98110, #3B82F610)', borderBottom: '2px solid #10B98150' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
            <span style={{ fontSize: '20px' }}>🤖</span>
            <span style={{ fontSize: '14px', fontWeight: '800', color: '#10B981', letterSpacing: '0.5px' }}>AI OUTREACH AGENT</span>
          </div>
          
          {/* Who They Are */}
          {aiResearch.whoTheyAre && (
            <div style={{ marginBottom: '16px', padding: '12px', background: '#0A0A0F', borderRadius: '8px', border: '1px solid #1E293B' }}>
              <div style={{ fontSize: '10px', color: '#64748B', letterSpacing: '1px', fontWeight: '700', marginBottom: '6px' }}>👤 WHO THEY ARE</div>
              <div style={{ fontSize: '13px', color: '#E2E8F0', lineHeight: '1.5' }}>{aiResearch.whoTheyAre}</div>
            </div>
          )}
          
          {/* Opening Line - Most Important */}
          {aiResearch.openingLine && (
            <div style={{ marginBottom: '16px', padding: '14px', background: '#3B82F615', borderRadius: '8px', border: '2px solid #3B82F650' }}>
              <div style={{ fontSize: '10px', color: '#3B82F6', letterSpacing: '1px', fontWeight: '700', marginBottom: '8px' }}>💬 YOUR OPENING LINE</div>
              <div style={{ fontSize: '14px', color: '#FFFFFF', lineHeight: '1.6', fontStyle: 'italic' }}>"{aiResearch.openingLine}"</div>
              <button 
                onClick={() => navigator.clipboard.writeText(aiResearch.openingLine)}
                style={{ marginTop: '8px', fontSize: '11px', padding: '4px 10px', background: '#3B82F620', border: '1px solid #3B82F6', borderRadius: '4px', color: '#3B82F6', cursor: 'pointer' }}
              >
                📋 Copy
              </button>
            </div>
          )}
          
          {/* Key Hook */}
          {aiResearch.keyHook && (
            <div style={{ marginBottom: '16px', padding: '12px', background: '#F59E0B10', borderRadius: '8px', border: '1px solid #F59E0B40' }}>
              <div style={{ fontSize: '10px', color: '#F59E0B', letterSpacing: '1px', fontWeight: '700', marginBottom: '6px' }}>🎯 KEY HOOK FOR THIS INVESTOR</div>
              <div style={{ fontSize: '13px', color: '#E2E8F0', lineHeight: '1.5' }}>{aiResearch.keyHook}</div>
            </div>
          )}
          
          {/* Subject Line */}
          {aiResearch.subjectLine && (
            <div style={{ marginBottom: '16px', padding: '10px 12px', background: '#0A0A0F', borderRadius: '6px', border: '1px solid #1E293B', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '10px', color: '#64748B', marginRight: '8px' }}>SUBJECT:</span>
                <span style={{ fontSize: '13px', color: '#FFFFFF' }}>{aiResearch.subjectLine}</span>
              </div>
              <button 
                onClick={() => navigator.clipboard.writeText(aiResearch.subjectLine)}
                style={{ fontSize: '10px', padding: '3px 8px', background: 'transparent', border: '1px solid #3B82F6', borderRadius: '4px', color: '#3B82F6', cursor: 'pointer' }}
              >
                Copy
              </button>
            </div>
          )}
          
          {/* What to Avoid */}
          {aiResearch.whatToAvoid && (
            <div style={{ padding: '10px 12px', background: '#EF444410', borderRadius: '6px', border: '1px solid #EF444430' }}>
              <div style={{ fontSize: '10px', color: '#EF4444', letterSpacing: '1px', fontWeight: '700', marginBottom: '4px' }}>⚠️ AVOID</div>
              <div style={{ fontSize: '12px', color: '#FCA5A5', lineHeight: '1.4' }}>{aiResearch.whatToAvoid}</div>
            </div>
          )}
        </div>
      )}

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
          {/* Stage - auto sets priority to high when committed */}
          <div>
            <label style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700' }}>STAGE</label>
            <select 
              style={{ ...S.select, width: '100%', marginTop: '4px' }} 
              value={form.stage} 
              onChange={e => { 
                const newStage = e.target.value;
                // Auto-set priority to high for committed, term-sheet, or in-diligence
                const autoHighPriority = ['committed', 'term-sheet', 'in-diligence'].includes(newStage);
                setForm(p => ({ 
                  ...p, 
                  stage: newStage,
                  priority: autoHighPriority ? 'high' : p.priority 
                })); 
                setEditing(true); 
              }}
            >
              {Object.entries(PIPELINE_STAGES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          
          {/* Priority */}
          <div>
            <label style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700' }}>PRIORITY</label>
            <select 
              style={{ ...S.select, width: '100%', marginTop: '4px' }} 
              value={form.priority} 
              onChange={e => { setForm(p => ({ ...p, priority: e.target.value })); setEditing(true); }}
            >
              {Object.entries({ high: { label: '🔴 High' }, medium: { label: '🟡 Medium' }, low: { label: '⚪ Low' } }).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          
          {/* Pitch Angle - only show if not committed or passed */}
          {!['committed', 'passed'].includes(form.stage) && (
            <div>
              <label style={{ fontSize: '9px', color: '#64748B', letterSpacing: '1px', fontWeight: '700' }}>PITCH ANGLE</label>
              <select 
                style={{ ...S.select, width: '100%', marginTop: '4px' }} 
                value={form.pitchAngle} 
                onChange={e => { setForm(p => ({ ...p, pitchAngle: e.target.value })); setEditing(true); }}
              >
                {Object.entries(PITCH_ANGLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          )}
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

        {/* Pitch Recommendation - only show if not committed or passed */}
        {angle && !['committed', 'passed'].includes(form.stage) && (
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
        
        {/* Show commitment amount prominently for committed investors */}
        {form.stage === 'committed' && (
          <div style={{ background: '#10B98120', borderRadius: '8px', padding: '16px', marginBottom: '16px', border: '1px solid #10B981', textAlign: 'center' }}>
            <div style={{ fontSize: '9px', color: '#10B981', letterSpacing: '1px', fontWeight: '700', marginBottom: '8px' }}>✅ COMMITTED</div>
            <div style={{ fontSize: '28px', fontWeight: '800', color: '#10B981' }}>${(form.commitment || 0).toLocaleString()}</div>
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
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'kanban'
  const [draggedInvestor, setDraggedInvestor] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMode, setBulkMode] = useState(false);
  
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };
  
  const selectAll = () => {
    setSelectedIds(new Set(filtered.map(i => i.id)));
  };
  
  const clearSelection = () => {
    setSelectedIds(new Set());
  };
  
  const bulkUpdateStage = async (newStage) => {
    const autoHighPriority = ['committed', 'term-sheet', 'in-diligence'].includes(newStage);
    setInvestors(prev => prev.map(i => 
      selectedIds.has(i.id) 
        ? { ...i, stage: newStage, priority: autoHighPriority ? 'high' : i.priority }
        : i
    ));
    setSelectedIds(new Set());
    setBulkMode(false);
  };
  
  const filtered = useMemo(() => {
    let r = [...investors];
    if (filters.search) { const q = filters.search.toLowerCase(); r = r.filter(i => [i.name, i.company, i.email, i.notes].some(f => (f || '').toLowerCase().includes(q))); }
    if (filters.type !== 'all') r = r.filter(i => i.type === filters.type);
    if (viewMode === 'table' && filters.stage !== 'all') r = r.filter(i => i.stage === filters.stage);
    if (filters.priority !== 'all') r = r.filter(i => i.priority === filters.priority);
    if (filters.source !== 'all') r = r.filter(i => i.source === filters.source);
    r.sort((a, b) => {
      if (filters.sort === 'engagement') return calculateEngagementScore(b) - calculateEngagementScore(a);
      if (filters.sort === 'commitment') return (b.commitment || 0) - (a.commitment || 0);
      if (filters.sort === 'stage') return (PIPELINE_STAGES[a.stage]?.order || 0) - (PIPELINE_STAGES[b.stage]?.order || 0);
      return (a.name || '').localeCompare(b.name || '');
    });
    return r;
  }, [investors, filters, viewMode]);

  const selected = selectedId ? investors.find(i => i.id === selectedId) : null;
  
  // Drag and drop handlers
  const handleDragStart = (e, investor) => {
    setDraggedInvestor(investor);
    e.dataTransfer.effectAllowed = 'move';
  };
  
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  
  const handleDrop = (e, newStage) => {
    e.preventDefault();
    if (draggedInvestor && draggedInvestor.stage !== newStage) {
      // Auto-set priority to high for committed/term-sheet/in-diligence
      const autoHighPriority = ['committed', 'term-sheet', 'in-diligence'].includes(newStage);
      setInvestors(prev => prev.map(i => 
        i.id === draggedInvestor.id 
          ? { ...i, stage: newStage, priority: autoHighPriority ? 'high' : i.priority }
          : i
      ));
    }
    setDraggedInvestor(null);
  };

  // Kanban columns
  const kanbanStages = Object.entries(PIPELINE_STAGES).filter(([k]) => !['passed'].includes(k));

  return (
    <div style={{ display: 'flex', gap: '16px', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: viewMode === 'kanban' ? 'auto' : 'hidden' }}>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* View Mode Toggle */}
          <div style={{ display: 'flex', gap: '2px', background: '#1E293B', borderRadius: '8px', padding: '2px' }}>
            <button 
              onClick={() => setViewMode('table')} 
              style={{ ...S.btn(), fontSize: '11px', padding: '6px 12px', background: viewMode === 'table' ? '#3B82F6' : 'transparent', color: viewMode === 'table' ? '#FFF' : '#64748B' }}
            >
              📋 Table
            </button>
            <button 
              onClick={() => setViewMode('kanban')} 
              style={{ ...S.btn(), fontSize: '11px', padding: '6px 12px', background: viewMode === 'kanban' ? '#3B82F6' : 'transparent', color: viewMode === 'kanban' ? '#FFF' : '#64748B' }}
            >
              📊 Kanban
            </button>
          </div>
          <input style={{ ...S.input, width: '200px' }} placeholder="Search..." value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))} />
          <select style={S.select} value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
            <option value="all">All Types</option>
            {Object.entries(INVESTOR_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
          {viewMode === 'table' && (
            <select style={S.select} value={filters.stage} onChange={e => setFilters(f => ({ ...f, stage: e.target.value }))}>
              <option value="all">All Stages</option>
              {Object.entries(PIPELINE_STAGES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          )}
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
          {viewMode === 'table' && (
            <select style={S.select} value={filters.sort} onChange={e => setFilters(f => ({ ...f, sort: e.target.value }))}>
              <option value="name">Sort: Name</option>
              <option value="engagement">Sort: Engagement</option>
              <option value="commitment">Sort: Commitment</option>
              <option value="stage">Sort: Stage</option>
            </select>
          )}
          <span style={{ fontSize: '11px', color: '#64748B' }}>{filtered.length} results</span>
          
          {/* Bulk Mode Toggle */}
          <button 
            onClick={() => { setBulkMode(!bulkMode); if (bulkMode) clearSelection(); }}
            style={{ ...S.btn(), fontSize: '11px', padding: '8px 14px', background: bulkMode ? '#60A5FA20' : 'transparent', color: bulkMode ? '#60A5FA' : '#9BA3B5', border: '1px solid #2A2D3E' }}
          >
            {bulkMode ? '✓ Bulk Mode ON' : '☐ Bulk Edit'}
          </button>
          
          {/* Quick Reset Button */}
          <button 
            onClick={() => {
              const activeCount = investors.filter(i => !['committed', 'passed', 'identified'].includes(i.stage)).length;
              if (activeCount > 0 && confirm(`Reset ${activeCount} "active" investors back to "Identified"? (Keeps Committed and Passed as-is)`)) {
                setInvestors(prev => prev.map(i => 
                  !['committed', 'passed', 'identified'].includes(i.stage)
                    ? { ...i, stage: 'identified' }
                    : i
                ));
              }
            }}
            style={{ ...S.btn(), fontSize: '11px', padding: '8px 14px', background: '#F5980B20', color: '#F59E0B', border: '1px solid #F59E0B40' }}
          >
            ⚡ Reset Active → Identified
          </button>
        </div>
        
        {/* Bulk Action Bar */}
        {bulkMode && selectedIds.size > 0 && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '14px 18px', background: 'linear-gradient(135deg, #60A5FA15, #3B82F615)', borderRadius: '10px', marginBottom: '16px', border: '1px solid #60A5FA40' }}>
            <span style={{ fontSize: '14px', fontWeight: '600', color: '#60A5FA' }}>
              {selectedIds.size} selected
            </span>
            <span style={{ color: '#2A2D3E' }}>|</span>
            <span style={{ fontSize: '12px', color: '#9BA3B5' }}>Move to:</span>
            {Object.entries(PIPELINE_STAGES).map(([key, stage]) => (
              <button
                key={key}
                onClick={() => bulkUpdateStage(key)}
                style={{ ...S.btn(), fontSize: '11px', padding: '6px 12px', background: stage.color + '20', color: stage.color, border: `1px solid ${stage.color}40` }}
              >
                {stage.label}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <button onClick={selectAll} style={{ ...S.btn(), fontSize: '11px', padding: '6px 12px' }}>Select All</button>
            <button onClick={clearSelection} style={{ ...S.btn(), fontSize: '11px', padding: '6px 12px' }}>Clear</button>
          </div>
        )}
        
        {bulkMode && selectedIds.size === 0 && (
          <div style={{ padding: '12px 16px', background: '#1A1B28', borderRadius: '8px', marginBottom: '16px', border: '1px dashed #2A2D3E' }}>
            <span style={{ fontSize: '13px', color: '#9BA3B5' }}>👆 Click on investors to select them, then choose a stage to move them to</span>
          </div>
        )}

        {/* KANBAN VIEW */}
        {viewMode === 'kanban' && (
          <div style={{ display: 'flex', gap: '12px', minWidth: 'max-content', paddingBottom: '16px' }}>
            {kanbanStages.map(([stageKey, stage]) => {
              const stageInvestors = filtered.filter(i => i.stage === stageKey);
              return (
                <div 
                  key={stageKey}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, stageKey)}
                  style={{ 
                    width: '220px', 
                    minHeight: '400px',
                    background: draggedInvestor ? '#1E293B30' : '#0F1117',
                    borderRadius: '10px',
                    border: `2px solid ${draggedInvestor ? stage.color + '60' : '#1E293B'}`,
                    transition: 'border-color 0.2s, background 0.2s'
                  }}
                >
                  {/* Column Header */}
                  <div style={{ padding: '12px', borderBottom: `2px solid ${stage.color}40`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: stage.color }}>{stage.label}</span>
                    <span style={{ fontSize: '11px', color: '#64748B', background: '#1E293B', padding: '2px 8px', borderRadius: '10px' }}>{stageInvestors.length}</span>
                  </div>
                  
                  {/* Cards */}
                  <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '500px', overflowY: 'auto' }}>
                    {stageInvestors.slice(0, 20).map(inv => (
                      <div
                        key={inv.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, inv)}
                        onClick={() => setSelectedId(inv.id)}
                        style={{
                          padding: '10px',
                          background: selectedId === inv.id ? '#3B82F620' : '#111318',
                          border: `1px solid ${selectedId === inv.id ? '#3B82F6' : '#1E293B'}`,
                          borderRadius: '8px',
                          cursor: 'grab',
                          transition: 'transform 0.1s, box-shadow 0.1s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)'; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = 'none'; }}
                      >
                        <div style={{ fontSize: '12px', fontWeight: '600', color: '#F8FAFC', marginBottom: '4px' }}>{inv.name}</div>
                        {inv.company && inv.company !== inv.name && (
                          <div style={{ fontSize: '10px', color: '#64748B', marginBottom: '6px' }}>{inv.company}</div>
                        )}
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                          <span style={{ 
                            fontSize: '9px', 
                            padding: '2px 6px', 
                            borderRadius: '4px',
                            background: (INVESTOR_TYPES[inv.type] || INVESTOR_TYPES.other).color + '20',
                            color: (INVESTOR_TYPES[inv.type] || INVESTOR_TYPES.other).color 
                          }}>
                            {(INVESTOR_TYPES[inv.type] || INVESTOR_TYPES.other).icon}
                          </span>
                          {inv.priority === 'high' && <span style={{ fontSize: '10px', color: '#EF4444' }}>●</span>}
                          {inv.email && <span style={{ fontSize: '10px' }}>📧</span>}
                        </div>
                      </div>
                    ))}
                    {stageInvestors.length > 20 && (
                      <div style={{ fontSize: '10px', color: '#64748B', textAlign: 'center', padding: '8px' }}>
                        +{stageInvestors.length - 20} more
                      </div>
                    )}
                    {stageInvestors.length === 0 && (
                      <div style={{ fontSize: '11px', color: '#475569', textAlign: 'center', padding: '20px', fontStyle: 'italic' }}>
                        Drop here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* TABLE VIEW */}
        {viewMode === 'table' && (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {bulkMode && <th style={{ ...S.th, width: '40px', textAlign: 'center' }}>☐</th>}
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
              const isSelected = selectedIds.has(i.id);
              return (
                <tr 
                  key={i.id} 
                  style={{ 
                    cursor: 'pointer', 
                    background: isSelected ? 'rgba(96,165,250,0.15)' : selectedId === i.id ? 'rgba(30,41,59,0.3)' : 'transparent',
                    borderLeft: isSelected ? '3px solid #60A5FA' : '3px solid transparent'
                  }} 
                  onClick={() => bulkMode ? toggleSelect(i.id) : setSelectedId(i.id)}
                >
                  {bulkMode && (
                    <td style={{ ...S.td, textAlign: 'center', width: '40px' }}>
                      <div style={{ 
                        width: '20px', 
                        height: '20px', 
                        borderRadius: '4px', 
                        border: `2px solid ${isSelected ? '#60A5FA' : '#2A2D3E'}`,
                        background: isSelected ? '#60A5FA' : 'transparent',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        margin: '0 auto'
                      }}>
                        {isSelected && <span style={{ color: '#000', fontSize: '12px', fontWeight: '800' }}>✓</span>}
                      </div>
                    </td>
                  )}
                  <td style={S.td}>
                    <div style={{ fontWeight: '600', color: '#F8FAFC' }}>{i.name}</div>
                    {i.company && i.company !== i.name && <div style={{ fontSize: '10px', color: '#64748B' }}>{i.company}</div>}
                  </td>
                  <td style={S.td}><span style={S.badge(tc.color)}>{tc.icon} {tc.label}</span></td>
                  <td style={S.td}>
                    <select 
                      value={
                        i.stage === 'committed' ? 'committed' :
                        i.stage === 'passed' ? 'passed' :
                        i.stage === 'identified' ? 'identified' :
                        'active'
                      }
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const selection = e.target.value;
                        let newStage = i.stage;
                        let newPriority = i.priority;
                        
                        if (selection === 'committed') {
                          newStage = 'committed';
                          newPriority = 'high';
                        } else if (selection === 'active') {
                          newStage = 'in-contact';
                          newPriority = 'high';
                        } else if (selection === 'identified') {
                          newStage = 'identified';
                        } else if (selection === 'passed') {
                          newStage = 'passed';
                          newPriority = 'low';
                        }
                        
                        setInvestors(prev => prev.map(inv => 
                          inv.id === i.id 
                            ? { ...inv, stage: newStage, priority: newPriority }
                            : inv
                        ));
                      }}
                      style={{ 
                        padding: '6px 10px', 
                        borderRadius: '8px', 
                        border: `1px solid ${sc.color}40`,
                        background: sc.color + '20', 
                        color: sc.color, 
                        fontSize: '12px', 
                        fontWeight: '600',
                        cursor: 'pointer',
                        outline: 'none'
                      }}
                    >
                      <option value="identified" style={{ background: '#0C0C12', color: '#64748B' }}>📋 Identified</option>
                      <option value="active" style={{ background: '#0C0C12', color: '#3B82F6' }}>🎯 Active Pipeline</option>
                      <option value="committed" style={{ background: '#0C0C12', color: '#10B981' }}>✅ Committed</option>
                      <option value="passed" style={{ background: '#0C0C12', color: '#6B7280' }}>⏸️ Passed</option>
                    </select>
                  </td>
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
        )}
        {viewMode === 'table' && filtered.length > 150 && <div style={{ padding: '12px', textAlign: 'center', color: '#64748B', fontSize: '11px' }}>Showing 150 of {filtered.length} — use filters to narrow</div>}
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

  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [cloudStatus, setCloudStatus] = useState(null); // 'synced', 'syncing', 'error'

  // Sync to cloud
  const syncToCloud = async () => {
    if (!supabase || cloudSyncing) return;
    setCloudSyncing(true);
    setCloudStatus('syncing');
    try {
      await bulkUpsertInvestors(investors);
      setCloudStatus('synced');
      localStorage.setItem('birdai-last-cloud-sync', new Date().toISOString());
    } catch (err) {
      console.error('Cloud sync error:', err);
      setCloudStatus('error');
    }
    setCloudSyncing(false);
  };

  // Load from cloud
  const loadFromCloud = async () => {
    if (!supabase) return null;
    setCloudSyncing(true);
    setCloudStatus('syncing');
    try {
      const cloudData = await fetchInvestors();
      if (cloudData && cloudData.length > 0) {
        setInvestors(cloudData);
        saveInvestors(cloudData);
        setCloudStatus('synced');
        setCloudSyncing(false);
        return cloudData;
      }
    } catch (err) {
      console.error('Cloud load error:', err);
      setCloudStatus('error');
    }
    setCloudSyncing(false);
    return null;
  };

  // Load - try cloud first, then localStorage + real-time sync
  useEffect(() => {
    let channel = null;
    
    const initLoad = async () => {
      // First try localStorage for immediate load
      const stored = loadInvestors();
      setInvestors(stored || buildInitialInvestors());
      setLoaded(true);

      // Then try cloud if available
      if (supabase) {
        try {
          const cloudData = await fetchInvestors();
          if (cloudData && cloudData.length > 0) {
            // Cloud has data - use it (it's the source of truth)
            setInvestors(cloudData);
            saveInvestors(cloudData);
            setCloudStatus('synced');
          } else if (stored && stored.length > 0) {
            // Cloud is empty but local has data - sync local to cloud
            await bulkUpsertInvestors(stored);
            setCloudStatus('synced');
          }
        } catch (err) {
          console.error('Initial cloud sync error:', err);
          setCloudStatus('error');
        }
        
        // Subscribe to real-time changes
        channel = subscribeToChanges((payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const updated = fromDbFormat(payload.new);
            setInvestors(prev => {
              const exists = prev.find(i => i.id === updated.id);
              if (exists) {
                return prev.map(i => i.id === updated.id ? updated : i);
              } else {
                return [...prev, updated];
              }
            });
          } else if (payload.eventType === 'DELETE') {
            setInvestors(prev => prev.filter(i => i.id !== payload.old.id));
          }
          setCloudStatus('synced');
        });
      }
    };
    initLoad();
    
    // Cleanup subscription on unmount
    return () => {
      if (channel) unsubscribeFromChanges(channel);
    };
  }, []);

  // Save on change - to localStorage immediately, debounced to cloud
  useEffect(() => {
    if (loaded && investors.length > 0) {
      // Save to localStorage immediately
      const t = setTimeout(() => saveInvestors(investors), 500);
      
      // Debounced save to cloud
      const cloudT = setTimeout(async () => {
        if (supabase) {
          try {
            await bulkUpsertInvestors(investors);
            setCloudStatus('synced');
          } catch (err) {
            console.error('Auto cloud sync error:', err);
          }
        }
      }, 2000); // Wait 2 seconds of inactivity before syncing to cloud
      
      return () => {
        clearTimeout(t);
        clearTimeout(cloudT);
      };
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
      <header style={{ background: 'linear-gradient(180deg, #181922 0%, #14151F 100%)', borderBottom: '1px solid #2A2D3E', padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '44px', height: '44px', background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '20px', color: '#000', boxShadow: '0 4px 14px rgba(34,197,94,0.3)' }}>B</div>
          <div>
            <div style={{ fontSize: '22px', fontWeight: '800', letterSpacing: '3px', color: '#FFFFFF' }}>BIRDAI</div>
            <div style={{ fontSize: '12px', color: '#9BA3B5', letterSpacing: '1px', fontWeight: '500' }}>FUNDRAISING COMMAND CENTER</div>
          </div>
        </div>
        <nav style={{ display: 'flex', gap: '4px', background: '#0C0C12', borderRadius: '12px', padding: '5px', border: '1px solid #2A2D3E' }}>
          {[{ k: 'dashboard', l: '📊 Dashboard' }, { k: 'pipeline', l: '🎯 Pipeline' }, { k: 'outreach', l: '📧 Outreach' }, { k: 'playbook', l: '📖 Playbook' }].map(t => (
            <button key={t.k} onClick={() => setView(t.k)} style={{ padding: '12px 24px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '600', fontFamily: 'inherit', background: view === t.k ? 'linear-gradient(135deg, #22C55E 0%, #16A34A 100%)' : 'transparent', color: view === t.k ? '#000' : '#9BA3B5', transition: 'all 0.2s' }}>{t.l}</button>
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
          
          {/* Cloud Sync Status */}
          {supabase && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', background: cloudStatus === 'synced' ? '#10B98120' : cloudStatus === 'error' ? '#EF444420' : '#3B82F620', borderRadius: '8px', border: `1px solid ${cloudStatus === 'synced' ? '#10B981' : cloudStatus === 'error' ? '#EF4444' : '#3B82F6'}40` }}>
              <span style={{ fontSize: '12px' }}>
                {cloudSyncing ? '🔄' : cloudStatus === 'synced' ? '☁️ ✓' : cloudStatus === 'error' ? '☁️ ✗' : '☁️'}
              </span>
              <span style={{ fontSize: '11px', color: cloudStatus === 'synced' ? '#10B981' : cloudStatus === 'error' ? '#EF4444' : '#3B82F6' }}>
                {cloudSyncing ? 'Syncing...' : cloudStatus === 'synced' ? 'Cloud Synced' : cloudStatus === 'error' ? 'Sync Error' : 'Cloud'}
              </span>
              <button
                onClick={syncToCloud}
                disabled={cloudSyncing}
                style={{ ...S.btn(), fontSize: '10px', padding: '4px 8px', background: 'transparent', color: '#A0AEC0' }}
              >
                ↑ Push
              </button>
              <button
                onClick={loadFromCloud}
                disabled={cloudSyncing}
                style={{ ...S.btn(), fontSize: '10px', padding: '4px 8px', background: 'transparent', color: '#A0AEC0' }}
              >
                ↓ Pull
              </button>
            </div>
          )}
          
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
