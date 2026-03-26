import { createClient } from 'jsr:@supabase/supabase-js@2'

const SEQUENCE_DELAYS_DAYS = [0, 1, 3, 7, 14]

/**
 * Normalize phone to E.164 without the leading +
 * - If starts with '+', strip the '+' and use digits as-is (already has country code)
 * - Otherwise prepend '55' (Brazilian number without country code)
 */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) return trimmed.slice(1).replace(/\D/g, '')
  return '55' + trimmed.replace(/\D/g, '')
}

function extractFirstName(fullName: string): string {
  return fullName.trim().split(' ')[0]
}

/**
 * Parse comma-separated lead data: nome, whatsapp, role, volume, problem
 * The problems field may contain commas, so we split on the first 4 commas only.
 */
function parseLeadPayload(raw: string): Record<string, string> {
  const parts = raw.split(',')
  const name = parts[0]?.trim() ?? ''
  const phone = parts[1]?.trim() ?? ''
  const role = parts[2]?.trim() ?? ''
  const procedures_per_month = parts[3]?.trim() ?? ''
  const problems = parts.slice(4).join(',').trim() // rejoin remaining (problems may have commas)
  return { name, phone, role, procedures_per_month, problems }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const contentType = req.headers.get('content-type') ?? ''
  let name: string, phone: string, role: string, procedures_per_month: string, problems: string

  if (contentType.includes('application/json')) {
    let body: Record<string, string>
    try {
      body = await req.json()
    } catch {
      return new Response('Invalid JSON body', { status: 400 })
    }
    ;({ name, phone, role, procedures_per_month, problems } = body)
  } else {
    // Plain text CSV: nome, whatsapp, role, volume, problem
    const text = await req.text()
    ;({ name, phone, role, procedures_per_month, problems } = parseLeadPayload(text))
  }

  if (!name || !phone) {
    return new Response('Missing required fields: name, phone', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const normalizedPhone = normalizePhone(phone)

  // Upsert lead (re-submission by same phone resets status to active)
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .upsert(
      {
        name,
        phone: normalizedPhone,
        role: role ?? null,
        procedures_per_month: procedures_per_month ?? null,
        problems: problems ?? null,
        status: 'active',
      },
      { onConflict: 'phone', ignoreDuplicates: false }
    )
    .select('id')
    .single()

  if (leadError || !lead) {
    console.error('Error upserting lead:', leadError)
    return new Response('Failed to save lead', { status: 500 })
  }

  // Remove any existing pending messages before rescheduling
  await supabase
    .from('sequence_messages')
    .delete()
    .eq('lead_id', lead.id)
    .eq('status', 'pending')

  // Schedule all 5 messages
  const now = new Date()
  const messages = SEQUENCE_DELAYS_DAYS.map((delayDays, step) => {
    const scheduledAt = new Date(now)
    scheduledAt.setDate(scheduledAt.getDate() + delayDays)
    return {
      lead_id: lead.id,
      step,
      scheduled_at: scheduledAt.toISOString(),
      status: 'pending',
    }
  })

  const { error: msgError } = await supabase
    .from('sequence_messages')
    .insert(messages)

  if (msgError) {
    console.error('Error scheduling messages:', msgError)
    return new Response('Failed to schedule messages', { status: 500 })
  }

  console.log(
    `Lead ${extractFirstName(name)} (${normalizedPhone}) registered. ${messages.length} messages scheduled.`
  )

  return new Response(
    JSON.stringify({ success: true, lead_id: lead.id }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
