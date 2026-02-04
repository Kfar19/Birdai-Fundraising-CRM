import { INVESTOR_TYPES, PITCH_ANGLES, PIPELINE_STAGES } from './constants';

// ═══════════════════════════════════════════════════════════════
// TYPE CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

export function classifyInvestorType(raw) {
  const t = (raw.type || raw.investorType || "").toLowerCase();
  const n = (raw.name || raw.company || raw.firm || "").toLowerCase();
  const notes = (raw.notes || raw.aum || raw.description || "").toLowerCase();

  if (raw._source === "angel") return "angel";
  if (t.includes("sovereign") || t.includes("swf") || notes.includes("sovereign")) return "institutional";
  if (t.includes("pension") || t.includes("endowment") || n.includes("university") || n.includes("foundation") || n.includes("trs") || n.includes("pers")) return "pension-endowment";
  if (t.includes("fund of fund") || t.includes("fof") || t.includes("private markets")) return "fund-of-funds";
  if (t.includes("family office")) return "family-office";
  if (t.includes("corporate") || t.includes("corporate vc")) return "corporate-vc";
  if (t.includes("exchange")) return "exchange-vc";
  if (t.includes("crypto") || t.includes("web3") || t.includes("defi") || t.includes("blockchain")) return "crypto-vc";
  if (t.includes("tradfi") || t.includes("bank") || t.includes("investment bank") || t.includes("insurance") || t.includes("asset management")) return "tradfi";
  if (t.includes("individual") || t.includes("personal")) return "individual";
  if (t.includes("venture") || t.includes("vc") || t.includes("growth")) return "crypto-vc";
  if (raw._source === "inception") return "inception-fund";
  if (raw._source === "web3vc") return "crypto-vc";
  return "other";
}

export function suggestPitchAngle(type) {
  for (const [key, angle] of Object.entries(PITCH_ANGLES)) {
    if (angle.bestFor.includes(type)) return key;
  }
  return "neutral-auction";
}

// ═══════════════════════════════════════════════════════════════
// ENGAGEMENT SCORING
// ═══════════════════════════════════════════════════════════════

export function calculateEngagementScore(investor) {
  let score = 0;
  const now = Date.now();

  // Stage weight
  const stageScores = {
    committed: 100, "term-sheet": 80, "in-diligence": 60,
    "meeting-scheduled": 40, contacted: 20, "outreach-ready": 10,
    researching: 5, identified: 0, passed: 0,
  };
  score += stageScores[investor.stage] || 0;

  // Recency of contact
  if (investor.lastContact) {
    const daysSince = (now - new Date(investor.lastContact).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince < 7) score += 30;
    else if (daysSince < 14) score += 20;
    else if (daysSince < 30) score += 10;
    else score -= 10;
  }

  // Priority boost
  if (investor.priority === "high") score += 15;
  if (investor.priority === "medium") score += 5;

  // Activity volume
  if (investor.activities && investor.activities.length > 0) {
    score += Math.min(investor.activities.length * 5, 25);
  }

  // Commitment boost
  if (investor.commitment > 0) score += 20;

  return Math.max(0, Math.min(100, score));
}

// ═══════════════════════════════════════════════════════════════
// OUTREACH URGENCY
// ═══════════════════════════════════════════════════════════════

export function getOutreachUrgency(investor) {
  if (investor.stage === "committed" || investor.stage === "passed") return null;

  if (!investor.lastContact) {
    if (investor.stage === "outreach-ready" || investor.priority === "high") {
      return { level: "now", label: "Ready to contact", color: "#EF4444" };
    }
    return { level: "soon", label: "Needs research first", color: "#F59E0B" };
  }

  const daysSince = (Date.now() - new Date(investor.lastContact).getTime()) / (1000 * 60 * 60 * 24);

  if (investor.stage === "meeting-scheduled" || investor.stage === "in-diligence") {
    if (daysSince > 7) return { level: "now", label: `${Math.round(daysSince)}d since last touch — follow up`, color: "#EF4444" };
    return { level: "ok", label: "Active engagement", color: "#10B981" };
  }

  if (daysSince > 21) return { level: "now", label: `${Math.round(daysSince)}d cold — re-engage`, color: "#EF4444" };
  if (daysSince > 14) return { level: "soon", label: `${Math.round(daysSince)}d — warming needed`, color: "#F59E0B" };
  return { level: "ok", label: `${Math.round(daysSince)}d — on track`, color: "#10B981" };
}

// ═══════════════════════════════════════════════════════════════
// AI PRIORITIZATION ENGINE
// ═══════════════════════════════════════════════════════════════

export function getAIPrioritizedInvestors(investors) {
  const now = Date.now();
  
  // Score each investor with AI-like reasoning
  const scored = investors
    .filter(i => !['committed', 'passed'].includes(i.stage))
    .map(inv => {
      let score = 0;
      const reasons = [];
      
      // 1. Stage momentum (closer to close = higher priority)
      const stageWeight = {
        'term-sheet': 50, 'in-diligence': 40, 'meeting-scheduled': 35,
        'contacted': 25, 'outreach-ready': 20, 'researching': 10, 'identified': 5
      };
      score += stageWeight[inv.stage] || 0;
      if (inv.stage === 'term-sheet') reasons.push('🔥 Term sheet stage - close this!');
      if (inv.stage === 'in-diligence') reasons.push('📋 In diligence - keep momentum');
      if (inv.stage === 'meeting-scheduled') reasons.push('📅 Meeting scheduled - prepare');
      
      // 2. Investor type fit for crypto/Web3
      const typeFit = {
        'crypto-vc': 25, 'inception-fund': 22, 'exchange-vc': 20,
        'angel': 18, 'corporate-vc': 15, 'fund-of-funds': 12,
        'family-office': 10, 'institutional': 8, 'tradfi': 5
      };
      score += typeFit[inv.type] || 0;
      if (['crypto-vc', 'inception-fund', 'exchange-vc'].includes(inv.type)) {
        reasons.push('🎯 Strong crypto/Web3 thesis fit');
      }
      
      // 3. Timing urgency
      if (inv.lastContact) {
        const daysSince = (now - new Date(inv.lastContact).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince > 21 && inv.stage !== 'identified') {
          score += 20;
          reasons.push(`⚠️ ${Math.round(daysSince)} days cold - re-engage now`);
        } else if (daysSince > 14) {
          score += 15;
          reasons.push(`⏰ ${Math.round(daysSince)} days - follow up soon`);
        } else if (daysSince < 3) {
          score += 10;
          reasons.push('✅ Recently engaged - maintain momentum');
        }
      } else if (inv.stage === 'outreach-ready') {
        score += 18;
        reasons.push('🚀 Ready for first outreach');
      }
      
      // 4. Priority boost
      if (inv.priority === 'high') {
        score += 20;
        reasons.push('⭐ High priority target');
      } else if (inv.priority === 'medium') {
        score += 8;
      }
      
      // 5. Has email = actionable
      if (inv.email) {
        score += 10;
        reasons.push('📧 Email available - can reach out');
      } else {
        reasons.push('🔍 Need to find contact info');
      }
      
      // 6. Existing commitment/relationship
      if (inv.commitment > 0) {
        score += 15;
        reasons.push(`💰 Already committed $${(inv.commitment/1000).toFixed(0)}K`);
      }
      
      // 7. Activity signals interest
      if (inv.activities && inv.activities.length > 2) {
        score += 10;
        reasons.push('💬 Active conversation history');
      }
      
      // Generate action recommendation
      let action = '';
      if (!inv.email) {
        action = 'Find contact → Use Apollo or LinkedIn';
      } else if (inv.stage === 'identified' || inv.stage === 'researching') {
        action = 'Research their portfolio → Craft personalized intro';
      } else if (inv.stage === 'outreach-ready') {
        action = 'Send intro email using pitch playbook';
      } else if (inv.stage === 'contacted' && inv.lastContact) {
        const days = Math.round((now - new Date(inv.lastContact).getTime()) / (1000 * 60 * 60 * 24));
        action = days > 7 ? 'Send follow-up email' : 'Wait for response';
      } else if (inv.stage === 'meeting-scheduled') {
        action = 'Prepare deck & talking points';
      } else if (inv.stage === 'in-diligence') {
        action = 'Respond to DD questions promptly';
      } else if (inv.stage === 'term-sheet') {
        action = 'Review terms & close!';
      } else {
        action = 'Review and update status';
      }
      
      return {
        ...inv,
        aiScore: Math.round(score),
        aiReasons: reasons.slice(0, 3), // Top 3 reasons
        aiAction: action,
      };
    })
    .sort((a, b) => b.aiScore - a.aiScore);
  
  return scored.slice(0, 10); // Top 10 recommendations
}

// ═══════════════════════════════════════════════════════════════
// OUTREACH RECOMMENDATIONS ENGINE
// ═══════════════════════════════════════════════════════════════

export function generateRecommendations(investors) {
  const recs = [];

  // High priority, not yet contacted
  const highUncontacted = investors.filter(
    i => i.priority === "high" && ["identified", "researching", "outreach-ready"].includes(i.stage)
  );
  if (highUncontacted.length > 0) {
    recs.push({
      category: "🔴 High Priority — Not Yet Contacted",
      investors: highUncontacted.slice(0, 10),
      action: "These should be your first outreach targets",
    });
  }

  // Stale conversations
  const stale = investors.filter(i => {
    if (!i.lastContact || ["committed", "passed", "identified"].includes(i.stage)) return false;
    const days = (Date.now() - new Date(i.lastContact).getTime()) / (1000 * 60 * 60 * 24);
    return days > 14;
  }).sort((a, b) => new Date(a.lastContact) - new Date(b.lastContact));
  if (stale.length > 0) {
    recs.push({
      category: "⏰ Going Cold — Re-engage Now",
      investors: stale.slice(0, 10),
      action: "These conversations are cooling off",
    });
  }

  // Crypto VCs — research Sui/MEV overlap
  const cryptoVCs = investors.filter(i => i.type === "crypto-vc" && i.stage === "identified").slice(0, 10);
  if (cryptoVCs.length > 0) {
    recs.push({
      category: "⛓ Crypto VCs — Research & Outreach",
      investors: cryptoVCs,
      action: "Check portfolio for Sui/MEV/DeFi infrastructure overlap → warm intro",
    });
  }

  // Institutional high AUM
  const institutional = investors.filter(
    i => ["institutional", "pension-endowment", "fund-of-funds", "tradfi"].includes(i.type)
      && i.priority === "high"
      && i.stage !== "committed"
  ).slice(0, 10);
  if (institutional.length > 0) {
    recs.push({
      category: "🏛 Institutional Targets — FT Pedigree Angle",
      investors: institutional,
      action: "Lead with Franklin Templeton exit + institutional risk framework",
    });
  }

  // Angels without commitment amounts
  const angelsNoAmount = investors.filter(i => i.type === "angel" && (i.commitment === 0 || !i.commitment) && i.stage !== "passed");
  if (angelsNoAmount.length > 0) {
    recs.push({
      category: "👼 Angels — Close the Commitment",
      investors: angelsNoAmount.slice(0, 10),
      action: "These contacts need a specific ask and commitment confirmation",
    });
  }

  // Inception funds — first check writers
  const inceptionReady = investors.filter(i => i.type === "inception-fund" && i.stage === "identified").slice(0, 10);
  if (inceptionReady.length > 0) {
    recs.push({
      category: "🚀 Inception Funds — First Check Writers",
      investors: inceptionReady,
      action: "These funds specialize in pre-seed. Research crypto thesis fit → cold outreach",
    });
  }

  return recs;
}
