import { createClient } from 'jsr:@supabase/supabase-js@2'
import { extractFirstName, renderTemplate, type Lead } from '../_shared/templates.ts'

interface SequenceMessage {
  id: string
  step: number
  leads: Lead
}

interface MessageTemplate {
  step: number
  message_type: string
  body: string
  caption: string | null
}

async function sendWhatsAppMessage(
  phone: string,
  template: MessageTemplate,
  lead: Lead
): Promise<void> {
  const zapsterUrl = `${Deno.env.get('ZAPSTER_API_URL')}/wa/messages`
  const instanceId = Deno.env.get('ZAPSTER_INSTANCE_ID')!
  const token = Deno.env.get('ZAPSTER_TOKEN')!

  const renderedBody = renderTemplate(template.body, lead)

  let payload: Record<string, unknown>

  if (template.message_type === 'audio') {
    payload = {
      recipient: phone,
      instance_id: instanceId,
      media: {
        url: renderedBody,
        ptt: true,
        caption: template.caption ?? undefined,
      },
    }
  } else {
    // Both 'text' and 'video_link' are sent as text with link preview
    payload = {
      recipient: phone,
      text: renderedBody,
      instance_id: instanceId,
      link_preview: true,
    }
  }

  const res = await fetch(zapsterUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Zapster API error ${res.status}: ${text}`)
  }
}

Deno.serve(async (req) => {
  // Allow both GET (from cron ping) and POST
  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Fetch all due pending messages for active leads
  const { data: dueMessages, error } = await supabase
    .from('sequence_messages')
    .select('id, step, leads(id, name, phone, role, procedures_per_month, problems)')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .eq('leads.status', 'active')
    .not('leads', 'is', null)
    .limit(50) // process max 50 per run to stay within function timeout

  if (error) {
    console.error('Error fetching due messages:', error)
    return new Response('DB error', { status: 500 })
  }

  if (!dueMessages || dueMessages.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Fetch all templates once
  const { data: templates } = await supabase
    .from('message_templates')
    .select('step, message_type, body, caption')

  const templateMap = new Map<number, MessageTemplate>(
    (templates ?? []).map((t) => [t.step, t])
  )

  let sent = 0
  let failed = 0

  for (const msg of dueMessages as SequenceMessage[]) {
    const lead = msg.leads
    if (!lead) continue

    const template = templateMap.get(msg.step)
    if (!template) {
      console.warn(`No template found for step ${msg.step}`)
      continue
    }

    try {
      await sendWhatsAppMessage(lead.phone, template, lead)

      await supabase
        .from('sequence_messages')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', msg.id)

      console.log(`Sent step ${msg.step} to ${extractFirstName(lead.name)} (${lead.phone})`)
      sent++
    } catch (err) {
      console.error(`Failed to send step ${msg.step} to ${lead.phone}:`, err)

      await supabase
        .from('sequence_messages')
        .update({ status: 'failed', error: String(err) })
        .eq('id', msg.id)

      failed++
    }
  }

  return new Response(
    JSON.stringify({ processed: dueMessages.length, sent, failed }),
    { headers: { 'Content-Type': 'application/json' } }
  )
})
