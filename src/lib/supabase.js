import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Convert from app format to database format
export function toDbFormat(investor) {
  return {
    id: investor.id,
    name: investor.name,
    company: investor.company,
    email: investor.email,
    type: investor.type,
    stage: investor.stage,
    priority: investor.priority,
    pitch_angle: investor.pitchAngle,
    commitment: investor.commitment || 0,
    notes: investor.notes,
    next_action: investor.nextAction,
    last_contact: investor.lastContact,
    source: investor.source,
    website: investor.website,
    twitter: investor.twitter,
    location: investor.location,
    focus: investor.focus,
    aum: investor.aum,
    activities: investor.activities || [],
  };
}

// Convert from database format to app format
export function fromDbFormat(row) {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    type: row.type,
    stage: row.stage,
    priority: row.priority,
    pitchAngle: row.pitch_angle,
    commitment: row.commitment || 0,
    notes: row.notes,
    nextAction: row.next_action,
    lastContact: row.last_contact,
    source: row.source,
    website: row.website,
    twitter: row.twitter,
    location: row.location,
    focus: row.focus,
    aum: row.aum,
    activities: row.activities || [],
  };
}

// Fetch all investors
export async function fetchInvestors() {
  if (!supabase) return null;
  
  const { data, error } = await supabase
    .from('investors')
    .select('*')
    .order('name');
  
  if (error) {
    console.error('Error fetching investors:', error);
    return null;
  }
  
  return data.map(fromDbFormat);
}

// Upsert an investor (insert or update)
export async function upsertInvestor(investor) {
  if (!supabase) return null;
  
  const dbData = toDbFormat(investor);
  
  const { data, error } = await supabase
    .from('investors')
    .upsert(dbData, { onConflict: 'id' })
    .select()
    .single();
  
  if (error) {
    console.error('Error upserting investor:', error);
    return null;
  }
  
  return fromDbFormat(data);
}

// Bulk upsert investors (for initial sync)
export async function bulkUpsertInvestors(investors) {
  if (!supabase) return null;
  
  const dbData = investors.map(toDbFormat);
  
  const { data, error } = await supabase
    .from('investors')
    .upsert(dbData, { onConflict: 'id' })
    .select();
  
  if (error) {
    console.error('Error bulk upserting investors:', error);
    return null;
  }
  
  return data.map(fromDbFormat);
}

// Delete an investor
export async function deleteInvestor(id) {
  if (!supabase) return false;
  
  const { error } = await supabase
    .from('investors')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting investor:', error);
    return false;
  }
  
  return true;
}

// Subscribe to real-time changes
export function subscribeToChanges(callback) {
  if (!supabase) return null;
  
  const channel = supabase
    .channel('investors-changes')
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'investors' },
      (payload) => {
        console.log('Real-time update:', payload);
        callback(payload);
      }
    )
    .subscribe();
  
  return channel;
}

// Unsubscribe from real-time changes
export function unsubscribeFromChanges(channel) {
  if (channel) {
    supabase.removeChannel(channel);
  }
}

