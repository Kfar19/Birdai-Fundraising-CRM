# BIRDAI Fundraising Command Center

Fundraising & BD automation agent for BIRDAI's $2M seed raise.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

```
src/
├── app/
│   ├── globals.css        # Global styles
│   ├── layout.js          # Root layout + fonts
│   └── page.js            # Main app (all views)
├── data/
│   └── investors.js       # All 600+ investor seed data
└── lib/
    ├── constants.js        # Types, stages, pitch angles
    └── engine.js           # Scoring, urgency, recommendations
```

## Data Sources Loaded

| Source | Count | Details |
|--------|-------|---------|
| Angel Commitments | 36 | Named individuals with $ amounts (~$3.1M) |
| Sui Ecosystem | 20 | Mysten Labs backers (a16z, Jump, Binance Labs) |
| Direct VC Contacts | 37 | Named contacts with emails |
| Enhanced Database | 180+ | Institutional contacts (SWFs, pensions, endowments, family offices, asset managers) |
| Inception Funds | 220+ | Pre-seed/first-check writers |
| Web3 VC Funds | 90+ | Top US crypto VCs (Paradigm, Multicoin, etc.) |

**Total: 600+ contacts**

## Features

- **Dashboard** — KPIs, pipeline funnel, urgent actions
- **Pipeline** — Searchable/filterable table with detail panel
- **Outreach Intel** — AI-prioritized outreach recommendations
- **Pitch Playbook** — 5 pitch angles mapped to slides + investor types
- **Activity Logging** — Track emails, calls, meetings per investor
- **Engagement Scoring** — 0-100 score based on stage, recency, activity
- **Persistent Storage** — localStorage saves all changes

## Pitch Angles

1. **Jito for Sui** — For crypto-native VCs
2. **Order Flow Infrastructure** — For institutional/TradFi
3. **Execution Market Intelligence** — For data-oriented VCs
4. **Neutral Auction Layer** — For DeFi infrastructure investors
5. **Founder Pedigree Play** — For angels/family offices

## Contact Enrichment (Apollo.io)

The app includes AI-powered contact research via Apollo.io:

1. **Get your free API key** at [Apollo.io Settings](https://app.apollo.io/#/settings/integrations/api)
   - Free tier: 50 credits/month
   
2. **Create `.env.local`** in the project root:
   ```
   APOLLO_API_KEY=your_apollo_api_key_here
   ```

3. **Restart the dev server** and click "Find Contact" on any investor without an email

The system will automatically:
- Search for the right partner at each firm
- Filter by relevant titles (Partner, MD, etc.) based on investor type
- Return email + LinkedIn profile
- Suggest alternatives if multiple contacts found

**Manual Research Fallback**: If no API key is configured, use the LinkedIn/Google buttons to open pre-filled search queries.

## Deploy to Vercel

```bash
npx vercel
```

## Next Steps (Cursor)

Potential enhancements to build:
- [ ] CSV import/export for bulk contact management
- [ ] Email template generator per pitch angle
- [ ] Calendar integration for meeting scheduling
- [ ] Supabase backend for multi-user + real persistence
- [ ] Email tracking pixel integration
- [ ] Automated follow-up reminders via webhook
