import { google } from 'googleapis';
import { getServerSession } from 'next-auth';

export async function POST(request) {
  try {
    const { accessToken, investors } = await request.json();
    
    if (!accessToken) {
      return Response.json({ error: 'Not authenticated with Gmail' }, { status: 401 });
    }

    // Create OAuth2 client with the access token
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });
    
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    
    // Get sent emails from the last 30 days
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: `in:sent after:${thirtyDaysAgo}`,
      maxResults: 100,
    });
    
    const messages = response.data.messages || [];
    const updates = [];
    
    // Process each sent email
    for (const msg of messages.slice(0, 50)) { // Limit to 50 for speed
      try {
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['To', 'Subject', 'Date'],
        });
        
        const headers = fullMessage.data.payload.headers;
        const toHeader = headers.find(h => h.name === 'To')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const dateHeader = headers.find(h => h.name === 'Date')?.value || '';
        
        // Extract email addresses from To field
        const emailMatches = toHeader.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
        
        for (const email of emailMatches) {
          const emailLower = email.toLowerCase();
          
          // Try to match with an investor
          const matchedInvestor = investors.find(inv => {
            // Match by email
            if (inv.email && inv.email.toLowerCase() === emailLower) return true;
            
            // Match by company domain
            const domain = emailLower.split('@')[1];
            if (inv.company) {
              const companyLower = inv.company.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (domain.includes(companyLower) || companyLower.includes(domain.split('.')[0])) {
                return true;
              }
            }
            
            // Match by name in email
            if (inv.name) {
              const nameParts = inv.name.toLowerCase().split(' ');
              const emailName = emailLower.split('@')[0];
              if (nameParts.some(part => part.length > 2 && emailName.includes(part))) {
                return true;
              }
            }
            
            return false;
          });
          
          if (matchedInvestor) {
            updates.push({
              investorId: matchedInvestor.id,
              email: emailLower,
              subject,
              date: dateHeader,
              timestamp: new Date(dateHeader).toISOString(),
            });
          }
        }
      } catch (e) {
        console.error('Error processing message:', e.message);
      }
    }
    
    // Deduplicate updates by investor (keep most recent)
    const latestByInvestor = {};
    for (const update of updates) {
      const existing = latestByInvestor[update.investorId];
      if (!existing || new Date(update.timestamp) > new Date(existing.timestamp)) {
        latestByInvestor[update.investorId] = update;
      }
    }
    
    return Response.json({
      success: true,
      scanned: messages.length,
      matches: Object.values(latestByInvestor),
      message: `Found ${Object.keys(latestByInvestor).length} investor matches from ${messages.length} sent emails`,
    });
    
  } catch (error) {
    console.error('Gmail sync error:', error);
    return Response.json({ 
      error: 'Failed to sync Gmail',
      details: error.message,
    }, { status: 500 });
  }
}

