// ═══════════════════════════════════════════════════════════════
// INVESTOR TYPE CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════

export const INVESTOR_TYPES = {
  "angel": { label: "Angel", color: "#10B981", icon: "👼" },
  "crypto-vc": { label: "Crypto/Web3 VC", color: "#8B5CF6", icon: "⛓" },
  "institutional": { label: "Institutional / SWF", color: "#3B82F6", icon: "🏛" },
  "fund-of-funds": { label: "Fund of Funds", color: "#F59E0B", icon: "📊" },
  "corporate-vc": { label: "Corporate VC", color: "#EF4444", icon: "🏢" },
  "inception-fund": { label: "Inception Stage Fund", color: "#EC4899", icon: "🚀" },
  "family-office": { label: "Family Office", color: "#14B8A6", icon: "🏠" },
  "pension-endowment": { label: "Pension / Endowment", color: "#6366F1", icon: "🎓" },
  "exchange-vc": { label: "Exchange VC", color: "#F97316", icon: "💱" },
  "tradfi": { label: "TradFi / Banks", color: "#64748B", icon: "🏦" },
  "individual": { label: "Individual", color: "#A3A3A3", icon: "👤" },
  "other": { label: "Other", color: "#737373", icon: "📋" },
};

// ═══════════════════════════════════════════════════════════════
// PIPELINE STAGES
// ═══════════════════════════════════════════════════════════════

export const PIPELINE_STAGES = {
  "identified": { label: "Identified", color: "#94A3B8", order: 0 },
  "researching": { label: "Researching", color: "#A78BFA", order: 1 },
  "outreach-ready": { label: "Outreach Ready", color: "#60A5FA", order: 2 },
  "contacted": { label: "Contacted", color: "#FBBF24", order: 3 },
  "meeting-scheduled": { label: "Meeting Scheduled", color: "#FB923C", order: 4 },
  "in-diligence": { label: "In Diligence", color: "#F472B6", order: 5 },
  "term-sheet": { label: "Term Sheet", color: "#34D399", order: 6 },
  "committed": { label: "Committed", color: "#10B981", order: 7 },
  "passed": { label: "Passed", color: "#EF4444", order: 8 },
};

// ═══════════════════════════════════════════════════════════════
// PITCH ANGLES — mapped to deck slides & investor types
// ═══════════════════════════════════════════════════════════════

export const PITCH_ANGLES = {
  "jito-for-sui": {
    label: "Jito for Sui",
    description: "MEV infrastructure parallel — Jito went 0→90% on Solana, we're day 1 on Sui",
    bestFor: ["crypto-vc", "exchange-vc"],
    keySlides: [3, 6, 8, 11],
    talkingPoints: [
      "SIP-19 live — validators auto-accept tips, zero adoption grind",
      "SHIO competitor analysis — $494K Jan MEV from single pipe",
      "Jito went 0→90% in 18 months on Solana",
      "Neutral auction vs direct extraction — we're infrastructure, not a player",
    ],
  },
  "order-flow-infrastructure": {
    label: "Order Flow Infrastructure",
    description: "Wall Street pays $3.8B/yr for order flow routing — Sui DEXs pay nothing",
    bestFor: ["institutional", "tradfi", "fund-of-funds"],
    keySlides: [2, 4, 10, 14],
    talkingPoints: [
      "Kevin built ML hedge fund → sold to Franklin Templeton → built their crypto funds",
      "$3.8B PFOF market in TradFi — DeFi order flow is more valuable and unmonetized",
      "Institutional risk framework — protocol-level data, not block explorer scraping",
      "46 bps cost efficiency vs traditional MEV extraction approaches",
    ],
  },
  "execution-market-intelligence": {
    label: "Execution Market Intelligence",
    description: "Protocol-level data platform — MEV is just the first application",
    bestFor: ["crypto-vc", "corporate-vc"],
    keySlides: [4, 10, 11, 12],
    talkingPoints: [
      "3M+ transactions classified with proprietary MEV taxonomy",
      "Own Sui full node — 100% of chain, not sampled, real-time",
      "Jupiter parallel — they built flow classification last (Ultra Signaling), we build it first",
      "Platform play: MEV auction → DEX intelligence → multi-chain expansion",
    ],
  },
  "neutral-auction": {
    label: "Neutral Auction Layer",
    description: "We don't compete with DEXs — we're the infrastructure they all route through",
    bestFor: ["crypto-vc", "inception-fund"],
    keySlides: [4, 7, 8, 16],
    talkingPoints: [
      "SHIO = player + referee (conflict of interest). BIRDAI = neutral infrastructure",
      "7 DEXs on Sui — concentrated market, everyone reachable",
      "Zero-friction GTM: 'Send us your flow, we pay you'",
      "Sui Foundation aligned — flagged searcher monopoly as a threat",
    ],
  },
  "founder-pedigree": {
    label: "Founder Pedigree Play",
    description: "ML hedge fund → sold to Franklin Templeton → built their crypto funds → now this",
    bestFor: ["angel", "family-office", "individual", "inception-fund"],
    keySlides: [9, 15, 16],
    talkingPoints: [
      "Kevin: Built & sold ML hedge fund to Franklin Templeton, built their crypto funds post-acquisition",
      "Greg: Quant trader at Citadel 2020-2022, order flow & alpha generation specialist",
      "Both founders have built order flow infrastructure at institutional scale",
      "$2M seed at $20M post-money — 24+ months runway",
    ],
  },
};
