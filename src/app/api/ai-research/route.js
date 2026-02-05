import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request) {
  try {
    const { investor } = await request.json();
    
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ 
        error: 'Anthropic API key not configured',
        fallback: generateFallbackResearch(investor)
      }, { status: 200 });
    }

    const prompt = `You are a fundraising advisor for BirdAI, a crypto/DeFi startup building MEV infrastructure on Sui blockchain.

ABOUT BIRDAI:
- Building "Jito for Sui" - MEV auction infrastructure
- Founder Kevin: Built ML hedge fund, sold to Franklin Templeton, built their crypto funds
- Founder Greg: Former Citadel quant trader (2020-2022)
- Raising $2M seed at $20M post-money
- Key differentiator: Neutral auction layer (not competing with DEXs like SHIO does)

INVESTOR TO RESEARCH:
- Name: ${investor.name}
- Company: ${investor.company || 'Unknown'}
- Type: ${investor.type || 'Unknown'}
- Notes: ${investor.notes || 'None'}
- Current Stage: ${investor.stage || 'identified'}

Based on this investor's likely background, portfolio, and investment thesis, provide:

1. **WHO THEY ARE** (2-3 sentences about their likely background, what they invest in, and why they might care about BirdAI)

2. **OPENING LINE** (A personalized, non-generic cold email opening that would grab their attention. Reference something specific about their firm or likely interests.)

3. **KEY HOOK** (The single most compelling thing to say to THIS specific investor based on their type/background)

4. **WHAT TO AVOID** (One thing NOT to say or do with this investor type)

5. **SUGGESTED SUBJECT LINE** (For cold email)

Be specific and actionable. No generic advice. If you don't know much about them, make educated guesses based on their investor type and company name.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: prompt }
      ],
    });

    const content = message.content[0].text;
    
    // Parse the response into sections
    const research = parseResearchResponse(content);
    
    return NextResponse.json({ 
      success: true, 
      research,
      raw: content
    });

  } catch (error) {
    console.error('AI Research error:', error);
    return NextResponse.json({ 
      error: error.message,
      fallback: generateFallbackResearch(request.body?.investor || {})
    }, { status: 200 });
  }
}

function parseResearchResponse(text) {
  const sections = {
    whoTheyAre: '',
    openingLine: '',
    keyHook: '',
    whatToAvoid: '',
    subjectLine: ''
  };
  
  // Extract sections using regex
  const whoMatch = text.match(/WHO THEY ARE[*:\s]*([\s\S]*?)(?=\d\.|OPENING LINE|\*\*OPENING)/i);
  const openingMatch = text.match(/OPENING LINE[*:\s]*([\s\S]*?)(?=\d\.|KEY HOOK|\*\*KEY)/i);
  const hookMatch = text.match(/KEY HOOK[*:\s]*([\s\S]*?)(?=\d\.|WHAT TO AVOID|\*\*WHAT)/i);
  const avoidMatch = text.match(/WHAT TO AVOID[*:\s]*([\s\S]*?)(?=\d\.|SUGGESTED SUBJECT|\*\*SUGGESTED)/i);
  const subjectMatch = text.match(/SUGGESTED SUBJECT LINE[*:\s]*([\s\S]*?)$/i);
  
  if (whoMatch) sections.whoTheyAre = whoMatch[1].trim().replace(/^\*+|\*+$/g, '').trim();
  if (openingMatch) sections.openingLine = openingMatch[1].trim().replace(/^\*+|\*+$/g, '').trim();
  if (hookMatch) sections.keyHook = hookMatch[1].trim().replace(/^\*+|\*+$/g, '').trim();
  if (avoidMatch) sections.whatToAvoid = avoidMatch[1].trim().replace(/^\*+|\*+$/g, '').trim();
  if (subjectMatch) sections.subjectLine = subjectMatch[1].trim().replace(/^\*+|\*+$/g, '').replace(/^["']|["']$/g, '').trim();
  
  return sections;
}

function generateFallbackResearch(investor) {
  const type = investor.type || 'other';
  const company = investor.company || 'their firm';
  
  const typeHooks = {
    'crypto-vc': {
      whoTheyAre: `Likely a crypto-native VC focused on infrastructure and DeFi. They probably have Solana or L1/L2 exposure and understand MEV dynamics.`,
      openingLine: `"I noticed ${company}'s portfolio includes [Solana/DeFi infrastructure] - we're building the MEV layer that Sui is missing."`,
      keyHook: `Lead with the Jito comparison - they'll immediately understand the $2B+ opportunity.`,
      whatToAvoid: `Don't over-explain MEV basics - they know this space. Get to differentiation fast.`,
      subjectLine: `Jito for Sui - day 1 MEV infrastructure`
    },
    'angel': {
      whoTheyAre: `Individual investor, likely values founder relationship and pedigree over detailed metrics at this stage.`,
      openingLine: `"[Mutual connection] mentioned you back founders with institutional backgrounds - I sold my ML hedge fund to Franklin Templeton before starting BirdAI."`,
      keyHook: `Lead with founder pedigree - Franklin Templeton exit + Citadel background.`,
      whatToAvoid: `Don't send a long deck upfront. Request a quick call first.`,
      subjectLine: `Quick intro - ex-Franklin Templeton founder raising seed`
    },
    'institutional': {
      whoTheyAre: `Large institutional allocator (SWF, pension, endowment). They prioritize risk management, regulatory clarity, and proven teams.`,
      openingLine: `"Given ${company}'s focus on alternative assets, I wanted to share how we're bringing institutional-grade infrastructure to DeFi order flow."`,
      keyHook: `Emphasize the $3.8B PFOF market parallel and institutional risk framework.`,
      whatToAvoid: `Don't lead with "crypto" or "tokens" - lead with infrastructure and order flow.`,
      subjectLine: `Order flow infrastructure - institutional DeFi opportunity`
    },
    'inception-fund': {
      whoTheyAre: `Pre-seed/seed specialist. They bet early on teams and markets, expect high risk/return.`,
      openingLine: `"${company} writes first checks in crypto infrastructure - we're the first neutral MEV layer on Sui."`,
      keyHook: `Emphasize being first/early - SIP-19 just went live, we're day 1.`,
      whatToAvoid: `Don't oversell traction you don't have. They expect early stage.`,
      subjectLine: `First MEV auction on Sui - seed round open`
    }
  };
  
  return typeHooks[type] || typeHooks['crypto-vc'];
}

