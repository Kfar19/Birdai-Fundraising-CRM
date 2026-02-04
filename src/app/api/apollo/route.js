// Apollo.io API integration for contact enrichment

export async function POST(request) {
  const { company, type } = await request.json();
  
  const APOLLO_API_KEY = process.env.APOLLO_API_KEY;
  
  if (!APOLLO_API_KEY) {
    return Response.json({ 
      error: 'Apollo API key not configured. Add APOLLO_API_KEY to your .env.local file.',
      setup_url: 'https://app.apollo.io/settings/integrations/api'
    }, { status: 200 });
  }

  try {
    // Use Apollo's new mixed_people/api_search endpoint (per their deprecation notice)
    const response = await fetch('https://api.apollo.io/api/v1/mixed_people/api_search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': APOLLO_API_KEY,
      },
      body: JSON.stringify({
        organization_name: company,
        person_titles: getTitlesForType(type),
        per_page: 15,
        page: 1,
        reveal_personal_emails: true,
      }),
    });

    const data = await response.json();
    
    // Log for debugging
    console.log('Apollo response status:', response.status);
    console.log('Apollo response:', JSON.stringify(data).slice(0, 500));

    if (!response.ok) {
      // If main endpoint fails, return helpful error
      return Response.json({ 
        success: false,
        error: `Apollo API returned ${response.status}`,
        details: data.error || data.message || JSON.stringify(data),
        suggestion: 'Use the LinkedIn or Google buttons to search manually'
      });
    }
    
    if (data.people && data.people.length > 0) {
      // Prioritize people with emails, then by relevant investment titles
      const investorKeywords = ['partner', 'principal', 'investor', 'investment', 'venture', 'managing director', 'gp', 'general partner'];
      
      const scoredPeople = data.people.map(p => {
        let score = 0;
        const title = (p.title || '').toLowerCase();
        if (p.email) score += 100; // Strong preference for emails
        investorKeywords.forEach(kw => {
          if (title.includes(kw)) score += 10;
        });
        // Penalize non-investor roles
        if (title.includes('designer') || title.includes('engineer') || title.includes('marketing')) score -= 20;
        return { ...p, score };
      }).sort((a, b) => b.score - a.score);
      
      const bestMatch = scoredPeople[0];
      const hasEmail = !!bestMatch.email;
      
      return Response.json({
        success: true,
        hasEmail,
        contact: {
          name: bestMatch.name,
          email: bestMatch.email,
          title: bestMatch.title,
          linkedin: bestMatch.linkedin_url,
          company: bestMatch.organization?.name || company,
        },
        alternatives: scoredPeople.slice(0, 5).map(p => ({
          name: p.name,
          email: p.email,
          title: p.title,
          linkedin: p.linkedin_url,
        })),
        note: hasEmail ? null : 'Apollo free tier doesn\'t include emails. Use LinkedIn to reach out directly.',
      });
    }

    return Response.json({
      success: false,
      error: 'No contacts found at this company',
      suggestion: `Try searching LinkedIn for "${company}" partners`,
    });

  } catch (error) {
    console.error('Apollo API error:', error);
    return Response.json({ 
      success: false,
      error: 'Failed to connect to Apollo API',
      details: error.message,
      suggestion: 'Use the LinkedIn or Google buttons to search manually'
    });
  }
}

function getTitlesForType(investorType) {
  const titleMap = {
    'crypto-vc': ['Partner', 'General Partner', 'Managing Partner', 'Principal', 'Investment'],
    'institutional': ['Managing Director', 'Director', 'Head', 'Portfolio Manager'],
    'pension-endowment': ['CIO', 'Chief Investment', 'Director', 'Head'],
    'fund-of-funds': ['Partner', 'Managing Director', 'Principal', 'Head'],
    'family-office': ['CIO', 'Partner', 'Managing Director', 'Principal'],
    'angel': ['Founder', 'CEO', 'Managing Partner', 'Principal'],
    'inception-fund': ['Partner', 'General Partner', 'Founding Partner'],
    'corporate-vc': ['Partner', 'Director', 'Head', 'Principal'],
    'tradfi': ['Managing Director', 'Director', 'Head', 'VP'],
    'exchange-vc': ['Partner', 'Head', 'Director'],
  };
  
  return titleMap[investorType] || ['Partner', 'Director', 'Principal', 'Head'];
}
