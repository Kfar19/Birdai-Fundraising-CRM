// Vercel Cron Job - Runs every hour to sync Gmail
// For production, this needs a database to store OAuth tokens

export async function GET(request) {
  // Verify this is a cron request (Vercel adds this header)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // For local testing, allow without auth
    if (process.env.NODE_ENV === 'production') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  console.log('🔄 Cron: Gmail sync triggered at', new Date().toISOString());

  // TODO: For full production setup, you need:
  // 1. Database (Supabase/PlanetScale/MongoDB) to store:
  //    - User OAuth tokens (access_token, refresh_token)
  //    - Investor data
  // 2. Token refresh logic (Gmail tokens expire after 1 hour)
  // 3. Loop through all users and sync their Gmail

  // For now, log that cron is working
  return Response.json({ 
    success: true, 
    message: 'Cron triggered. For full automation, add database storage for OAuth tokens.',
    timestamp: new Date().toISOString(),
    nextSteps: [
      'Add Supabase or similar for persistent storage',
      'Store OAuth refresh tokens securely',
      'Implement token refresh logic',
      'Store investor data in database instead of localStorage'
    ]
  });
}

export const dynamic = 'force-dynamic';

