import { createClient } from 'jsr:@supabase/supabase-js@2'
import { extractFirstName, renderTemplate, type Lead } from '../_shared/templates.ts'

const LEAD_TRIGGER_PREFIX = 'Potencial Lead:'
const SEQUENCE_DELAYS_DAYS = [0, 1, 3, 7, 14]

// ─── Phone helpers ────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) return trimmed.slice(1).replace(/\D/g, '')
  return trimmed.replace(/\D/g, '')
}

function normalizeLeadPhone(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('+')) return trimmed.slice(1).replace(/\D/g, '')
  return '55' + trimmed.replace(/\D/g, '')
}

// ─── Zapster send ─────────────────────────────────────────────────────────────

async function sendWhatsAppText(phone: string, text: string): Promise<void> {
  const url = `${Deno.env.get('ZAPSTER_API_URL')}/wa/messages`
  const body = {
    recipient: phone,
    text,
    instance_id: Deno.env.get('ZAPSTER_INSTANCE_ID'),
    link_preview: true,
  }
  console.log(`Zapster send to ${phone}:`, JSON.stringify(body))
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('ZAPSTER_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const resText = await res.text()
  console.log(`Zapster response ${res.status}:`, resText)
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseLeadCsv(csv: string): Record<string, string> {
  const parts = csv.split(',')
  return {
    name: parts[0]?.trim() ?? '',
    phone: parts[1]?.trim() ?? '',
    role: parts[2]?.trim() ?? '',
    procedures_per_month: parts[3]?.trim() ?? '',
    problems: parts.slice(4).join(',').trim(),
  }
}

// ─── Lead registration ────────────────────────────────────────────────────────

async function registerLead(
  supabase: ReturnType<typeof createClient>,
  csv: string
): Promise<void> {
  const { name, phone, role, procedures_per_month, problems } = parseLeadCsv(csv)

  if (!name || !phone) {
    console.warn('Potencial Lead: missing name or phone, skipping')
    return
  }

  const normalizedPhone = normalizeLeadPhone(phone)

  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .upsert(
      { name, phone: normalizedPhone, role: role || null, procedures_per_month: procedures_per_month || null, problems: problems || null, status: 'active' },
      { onConflict: 'phone', ignoreDuplicates: false }
    )
    .select('id, name, phone, role, procedures_per_month, problems')
    .single()

  if (leadError || !lead) {
    console.error('Error upserting lead:', leadError)
    return
  }

  // Remove existing pending/approval messages
  await supabase
    .from('sequence_messages')
    .delete()
    .eq('lead_id', lead.id)
    .in('status', ['pending', 'awaiting_approval', 'awaiting_confirm'])

  const now = new Date()

  // Step 0: awaiting_approval (held until owner approves)
  const { data: step0, error: step0Error } = await supabase
    .from('sequence_messages')
    .insert({ lead_id: lead.id, step: 0, scheduled_at: now.toISOString(), status: 'awaiting_approval' })
    .select('id')
    .single()

  if (step0Error || !step0) {
    console.error('Error creating step 0:', step0Error)
    return
  }

  // Steps 1-4: scheduled normally
  const followups = SEQUENCE_DELAYS_DAYS.slice(1).map((delayDays, i) => {
    const scheduledAt = new Date(now)
    scheduledAt.setDate(scheduledAt.getDate() + delayDays)
    return { lead_id: lead.id, step: i + 1, scheduled_at: scheduledAt.toISOString(), status: 'pending' }
  })

  await supabase.from('sequence_messages').insert(followups)

  // Generate suggested step 0 message
  const { data: template } = await supabase
    .from('message_templates')
    .select('body')
    .eq('step', 0)
    .single()

  const suggestedMessage = template ? renderTemplate(template.body, lead as Lead) : ''

  // Store pending approval
  await supabase.from('pending_approvals').insert({
    sequence_message_id: step0.id,
    lead_id: lead.id,
    suggested_message: suggestedMessage,
  })

  // Notify owner
  const ownerPhone = Deno.env.get('OWNER_PHONE')!
  const notification =
    `*Novo Lead MedShare!* 🎯\n\n` +
    `*Nome:* ${lead.name}\n` +
    `*WhatsApp:* +${normalizedPhone}\n` +
    `*Cargo:* ${lead.role ?? 'não informado'}\n` +
    `*Volume:* ${lead.procedures_per_month ?? 'não informado'}\n` +
    `*Problemas:* ${lead.problems ?? 'não informado'}\n\n` +
    `*Mensagem sugerida:*\n` +
    `─────────────────\n` +
    `${suggestedMessage}\n` +
    `─────────────────\n\n` +
    `Responda *sim* para enviar essa mensagem, ou escreva a mensagem que prefere enviar no lugar.`

  await sendWhatsAppText(ownerPhone, notification)

  console.log(`Lead ${extractFirstName(lead.name)} (${normalizedPhone}) registered. Owner notified for approval.`)
}

// ─── Owner approval flow ──────────────────────────────────────────────────────

async function handleOwnerReply(
  supabase: ReturnType<typeof createClient>,
  replyText: string
): Promise<void> {
  const ownerPhone = Deno.env.get('OWNER_PHONE')!

  // Find oldest pending approval (awaiting_approval or awaiting_confirm)
  const { data: approval } = await supabase
    .from('pending_approvals')
    .select(`
      id,
      suggested_message,
      final_message,
      lead_id,
      sequence_message_id,
      sequence_messages!inner(status),
      leads!inner(name, phone)
    `)
    .in('sequence_messages.status', ['awaiting_approval', 'awaiting_confirm'])
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (!approval) {
    // No pending approval — could be a lead reply, handled elsewhere
    return
  }

  const seqStatus = (approval.sequence_messages as { status: string }).status
  const lead = approval.leads as { name: string; phone: string }
  const firstName = extractFirstName(lead.name)

  if (seqStatus === 'awaiting_approval') {
    // First reply: "sim" uses suggested, anything else is the custom message
    const contentToSend = replyText.trim().toLowerCase() === 'sim'
      ? approval.suggested_message
      : replyText.trim()

    // Store final message and advance state
    await supabase
      .from('pending_approvals')
      .update({ final_message: contentToSend })
      .eq('id', approval.id)

    await supabase
      .from('sequence_messages')
      .update({ status: 'awaiting_confirm' })
      .eq('id', approval.sequence_message_id)

    // Send confirmation to owner
    const confirmation =
      `*Confirmação de envio* ✅\n\n` +
      `*Para:* ${lead.name} (+${lead.phone})\n\n` +
      `*Mensagem que será enviada:*\n` +
      `─────────────────\n` +
      `${contentToSend}\n` +
      `─────────────────\n\n` +
      `Responda *sim* para confirmar e enviar.`

    await sendWhatsAppText(ownerPhone, confirmation)
    console.log(`Owner provided content for ${firstName}. Awaiting final confirmation.`)

  } else if (seqStatus === 'awaiting_confirm') {
    if (replyText.trim().toLowerCase() === 'sim') {
      // Send to lead
      await sendWhatsAppText(lead.phone, approval.final_message!)

      // Mark as sent
      await supabase
        .from('sequence_messages')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', approval.sequence_message_id)

      // Clean up approval
      await supabase.from('pending_approvals').delete().eq('id', approval.id)

      await sendWhatsAppText(ownerPhone, `Mensagem enviada para *${lead.name}* com sucesso! 🚀`)
      console.log(`Step 0 sent to ${firstName} (${lead.phone}) after owner approval.`)
    } else {
      // Owner changed their mind — treat new text as updated content, re-confirm
      await supabase
        .from('pending_approvals')
        .update({ final_message: replyText.trim() })
        .eq('id', approval.id)

      const reconfirmation =
        `*Nova confirmação de envio* ✅\n\n` +
        `*Para:* ${lead.name} (+${lead.phone})\n\n` +
        `*Mensagem que será enviada:*\n` +
        `─────────────────\n` +
        `${replyText.trim()}\n` +
        `─────────────────\n\n` +
        `Responda *sim* para confirmar e enviar.`

      await sendWhatsAppText(ownerPhone, reconfirmation)
      console.log(`Owner updated content for ${firstName}. Awaiting re-confirmation.`)
    }
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  console.log('Inbound webhook payload:', JSON.stringify(payload))

  const senderPhone = normalizePhone(
    String(payload?.sender ?? payload?.from ?? payload?.phone ?? '')
  )
  const messageBody = String(
    payload?.text ?? payload?.body ?? payload?.message ?? ''
  )

  if (!senderPhone) {
    console.warn('Could not extract sender phone from webhook payload')
    return new Response('OK', { status: 200 })
  }

  // Ignore outbound echo from MedShare sender
  const medsharePhone = normalizePhone(Deno.env.get('MEDSHARE_SENDER_PHONE') ?? '')
  if (senderPhone === medsharePhone) {
    return new Response('OK', { status: 200 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const ownerPhone = normalizePhone(Deno.env.get('OWNER_PHONE') ?? '')

  // ── Message from owner: handle approval flow ──
  if (senderPhone === ownerPhone) {
    if (messageBody.startsWith(LEAD_TRIGGER_PREFIX)) {
      // Owner can also register a lead manually
      const csv = messageBody.slice(LEAD_TRIGGER_PREFIX.length).trim()
      await registerLead(supabase, csv)
    } else {
      await handleOwnerReply(supabase, messageBody)
    }
    return new Response('OK', { status: 200 })
  }

  // ── "Potencial Lead:" from any other source ──
  if (messageBody.startsWith(LEAD_TRIGGER_PREFIX)) {
    const csv = messageBody.slice(LEAD_TRIGGER_PREFIX.length).trim()
    await registerLead(supabase, csv)
    return new Response('OK', { status: 200 })
  }

  // ── Inbound reply from a lead ──
  const { data: lead } = await supabase
    .from('leads')
    .select('id, name, status')
    .eq('phone', senderPhone)
    .single()

  await supabase.from('inbound_messages').insert({
    lead_id: lead?.id ?? null,
    phone: senderPhone,
    body: messageBody,
  })

  if (lead && lead.status === 'active') {
    await supabase.from('leads').update({ status: 'replied' }).eq('id', lead.id)

    await supabase
      .from('sequence_messages')
      .update({ status: 'skipped' })
      .eq('lead_id', lead.id)
      .in('status', ['pending', 'awaiting_approval', 'awaiting_confirm'])

    await supabase
      .from('pending_approvals')
      .delete()
      .eq('lead_id', lead.id)

    const firstName = extractFirstName(lead.name)
    const notification =
      `*Lead respondeu!* 💬\n\n` +
      `*${lead.name}* (+${senderPhone}):\n\n` +
      `_"${messageBody}"_\n\n` +
      `Sequência pausada. Hora de entrar em contato manualmente!`

    await sendWhatsAppText(ownerPhone, notification)
    console.log(`Lead ${firstName} (${senderPhone}) replied. Sequence stopped. Owner notified.`)
  }

  return new Response('OK', { status: 200 })
})
