import { createClient } from 'jsr:@supabase/supabase-js@2'

interface WeeklyPost {
  urls: string[]
  caption: string
  scheduledTime: string
  titulo: string
  music: string
}

interface WeeklyPosts {
  A?: WeeklyPost
  B?: WeeklyPost
  C?: WeeklyPost
}

// ─── Supabase Storage ─────────────────────────────────────────────────────────

async function readJson<T>(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  path: string
): Promise<T | null> {
  const { data, error } = await supabase.storage.from(bucket).download(path)
  if (error || !data) return null
  try { return JSON.parse(await data.text()) as T } catch { return null }
}

async function writeJson(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  path: string,
  payload: unknown
): Promise<void> {
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
  await supabase.storage.from(bucket).upload(path, blob, { upsert: true })
}

async function deleteFile(
  supabase: ReturnType<typeof createClient>,
  bucket: string,
  path: string
): Promise<void> {
  await supabase.storage.from(bucket).remove([path])
}

// ─── Blotato ──────────────────────────────────────────────────────────────────

async function schedulePost(post: WeeklyPost): Promise<string> {
  const res = await fetch('https://backend.blotato.com/v2/posts', {
    method: 'POST',
    headers: {
      'blotato-api-key': Deno.env.get('BLOTATO_API_KEY')!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      post: {
        accountId: Deno.env.get('BLOTATO_ACCOUNT_ID')!,
        content: { text: post.caption, mediaUrls: post.urls, platform: 'instagram' },
        target: { targetType: 'instagram' },
      },
      scheduledTime: post.scheduledTime,
    }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`Blotato error: ${JSON.stringify(json)}`)
  return json.postSubmissionId as string
}

// ─── Zapster ──────────────────────────────────────────────────────────────────

async function sendText(phone: string, text: string): Promise<void> {
  await fetch(`${Deno.env.get('ZAPSTER_API_URL')}/wa/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('ZAPSTER_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: phone,
      instance_id: Deno.env.get('ZAPSTER_INSTANCE_ID'),
      text,
    }),
  })
}

// ─── Claude CCR — trigger a regeneration ─────────────────────────────────────

async function triggerRegeneration(label: string, format: string): Promise<void> {
  const promptMap: Record<string, string> = {
    A: `You are the MedShare pipeline regenerating POST A (Carrossel) only. Execute without pausing.

Credentials:
BLOTATO_API_KEY=${Deno.env.get('BLOTATO_API_KEY') ?? ''}
BLOTATO_ACCOUNT_ID=${Deno.env.get('BLOTATO_ACCOUNT_ID') ?? ''}
SUPABASE_URL=${Deno.env.get('SUPABASE_URL') ?? ''}
SUPABASE_SERVICE_ROLE_KEY=${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}
ZAPSTER_API_URL=${Deno.env.get('ZAPSTER_API_URL') ?? ''}
ZAPSTER_TOKEN=${Deno.env.get('ZAPSTER_TOKEN') ?? ''}
ZAPSTER_INSTANCE_ID=${Deno.env.get('ZAPSTER_INSTANCE_ID') ?? ''}
OWNER_PHONE=${Deno.env.get('OWNER_PHONE') ?? ''}

1. Read weekly-posts.json from Supabase Storage bucket medshare-posts. Load the current A entry to know the theme.
2. Load squads/carrossel-medshare/_memory/memories.md and squads/carrossel-medshare/pipeline/data/domain-framework.md.
3. Generate a NEW 8-slide script for the same theme but with different angles. Save as a new run in squads/carrossel-medshare/output/.
4. Generate 8 HTML slides and render as PNGs (1080x1440px). Use same visual style as memories.md.
5. Upload all 8 PNGs to Blotato. Collect publicUrls.
6. Keep same scheduledTime and caption structure, just update the urls in weekly-posts.json entry A.
7. Update weekly-posts.json in Supabase with new A entry.
8. Send WhatsApp text to 4367761628024 with new slide texts and same format as original review message, ending with: Responda *confirmar A* para agendar ou *refazer A* para tentar novamente.`,

    B: `You are the MedShare pipeline regenerating POST B (Visual Quote) only. Execute without pausing.

Credentials:
BLOTATO_API_KEY=${Deno.env.get('BLOTATO_API_KEY') ?? ''}
BLOTATO_ACCOUNT_ID=${Deno.env.get('BLOTATO_ACCOUNT_ID') ?? ''}
SUPABASE_URL=${Deno.env.get('SUPABASE_URL') ?? ''}
SUPABASE_SERVICE_ROLE_KEY=${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}
ZAPSTER_API_URL=${Deno.env.get('ZAPSTER_API_URL') ?? ''}
ZAPSTER_TOKEN=${Deno.env.get('ZAPSTER_TOKEN') ?? ''}
ZAPSTER_INSTANCE_ID=${Deno.env.get('ZAPSTER_INSTANCE_ID') ?? ''}
OWNER_PHONE=${Deno.env.get('OWNER_PHONE') ?? ''}

1. Load squads/posts-medshare/pipeline/data/formatos.md (Visual Quote section), tone-of-voice.md, anti-patterns.md, _opensquad/_memory/company.md.
2. Generate 3 NEW Visual Quote concepts (different from previous). Pick best.
3. Write copy (frase, caption, 5 hashtags). Save to new run folder in squads/posts-medshare/output/.
4. Generate slide-01.html (1080x1080px) with OR background photo url(https://upload.wikimedia.org/wikipedia/commons/2/2e/Cardiac_surgery_operating_room.jpg), navy overlay rgba(11,37,69,0.72), teal radial accent, grid, vignette, top accent line. Phrase Inter Bold 66px white, highlighted words #39D2C0. Handle @medshareapp.
5. Render PNG with Playwright (npx playwright screenshot --viewport-size 1080,1080 --wait-for-timeout 4000).
6. Upload to Blotato. Collect publicUrl.
7. Update weekly-posts.json entry B with new urls, caption, titulo. Keep same scheduledTime.
8. Send WhatsApp: first the image, then text: *Post B novo — Visual Quote*\\nFrase: PHRASE\\nCaption: CAPTION\\nMusica: MUSIC_SUGGESTION\\n\\nResponda *confirmar B* para agendar ou *refazer B* para tentar novamente.`,

    C: `You are the MedShare pipeline regenerating POST C (${format}) only. Execute without pausing.

Credentials:
BLOTATO_API_KEY=${Deno.env.get('BLOTATO_API_KEY') ?? ''}
BLOTATO_ACCOUNT_ID=${Deno.env.get('BLOTATO_ACCOUNT_ID') ?? ''}
SUPABASE_URL=${Deno.env.get('SUPABASE_URL') ?? ''}
SUPABASE_SERVICE_ROLE_KEY=${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}
ZAPSTER_API_URL=${Deno.env.get('ZAPSTER_API_URL') ?? ''}
ZAPSTER_TOKEN=${Deno.env.get('ZAPSTER_TOKEN') ?? ''}
ZAPSTER_INSTANCE_ID=${Deno.env.get('ZAPSTER_INSTANCE_ID') ?? ''}
OWNER_PHONE=${Deno.env.get('OWNER_PHONE') ?? ''}

1. Load squads/posts-medshare/pipeline/data/formatos.md (${format} section), tone-of-voice.md, anti-patterns.md, _opensquad/_memory/company.md.
2. Generate 3 NEW concepts for ${format} (different from previous). Pick best. If Dado Impactante: verifiable number. If Provocacao Direta: provocative affirmation.
3. Write copy. Save to new run folder in squads/posts-medshare/output/.
4. Generate slide-01.html 1080x1080px. If Dado Impactante: dark gradient #0d2d58->#0B2545->#060f20 + teal accent, number 180px #39D2C0, unit 38px white, context 34px #BBBBBB, 72px grid. If Provocacao Direta: solid #0B2545, text Inter Bold 78px white 70-80% width, 1 keyword #39D2C0.
5. Render PNG with Playwright (npx playwright screenshot --viewport-size 1080,1080 --wait-for-timeout 3000).
6. Upload to Blotato. Collect publicUrl.
7. Update weekly-posts.json entry C with new data. Keep same scheduledTime.
8. Send WhatsApp: first image, then text: *Post C novo — ${format}*\\nConceito: CONCEPT\\nCaption: CAPTION\\nMusica: MUSIC_SUGGESTION\\n\\nResponda *confirmar C* para agendar ou *refazer C* para tentar novamente.`,
  }

  const prompt = promptMap[label]
  if (!prompt) return

  await fetch('https://api.anthropic.com/v1/claude-code/triggers/trig_01Sroak3mo8ArgzDHMJ5mRbL/run', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prompt }),
  })
}

// ─── Parse command ─────────────────────────────────────────────────────────────

function parseCommand(text: string): { action: string; labels: string[] } {
  const t = text.trim().toLowerCase()

  if (t === 'confirmar tudo' || t === 'confirmar a b c') return { action: 'confirm', labels: ['A', 'B', 'C'] }
  if (t === 'descartar tudo') return { action: 'discard', labels: ['A', 'B', 'C'] }
  if (t === 'refazer tudo') return { action: 'redo', labels: ['A', 'B', 'C'] }

  const confirmMatch = t.match(/^confirmar\s+([abc\s]+)$/)
  if (confirmMatch) {
    const labels = confirmMatch[1].toUpperCase().split(/\s+/).filter(l => ['A','B','C'].includes(l))
    return { action: 'confirm', labels }
  }

  const refazerMatch = t.match(/^refazer\s+([abc])$/)
  if (refazerMatch) return { action: 'redo', labels: [refazerMatch[1].toUpperCase()] }

  return { action: 'unknown', labels: [] }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return new Response('Invalid JSON', { status: 400 }) }

  const command = String(body.command ?? '')
  const ownerPhone = Deno.env.get('OWNER_PHONE')!

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { action, labels } = parseCommand(command)

  if (action === 'unknown') {
    await sendText(ownerPhone, `Comando nao reconhecido: "${command}"\n\nComandos validos:\nconfirmar A B C\nconfirmar A C\nrefazer B\nrefazer tudo\ndescartar tudo`)
    return new Response('OK', { status: 200 })
  }

  const posts = await readJson<WeeklyPosts>(supabase, 'medshare-posts', 'weekly-posts.json')
  if (!posts) {
    await sendText(ownerPhone, 'Nenhum post pendente encontrado. Aguarde a proxima segunda.')
    return new Response('OK', { status: 200 })
  }

  if (action === 'discard') {
    await deleteFile(supabase, 'medshare-posts', 'weekly-posts.json')
    await sendText(ownerPhone, 'Posts da semana descartados.')
    return new Response('OK', { status: 200 })
  }

  if (action === 'redo') {
    for (const label of labels) {
      const post = posts[label as keyof WeeklyPosts]
      const format = label === 'C' ? (post?.titulo?.split(':')[0] ?? 'Dado Impactante') : ''
      await triggerRegeneration(label, format)
    }
    await sendText(ownerPhone, `Regenerando post${labels.length > 1 ? 's' : ''} ${labels.join(', ')}... chega em ~5 minutos.`)
    return new Response('OK', { status: 200 })
  }

  if (action === 'confirm') {
    const confirmed: string[] = []
    const errors: string[] = []

    for (const label of labels) {
      const post = posts[label as keyof WeeklyPosts]
      if (!post) { errors.push(label); continue }

      try {
        const id = await schedulePost(post)
        confirmed.push(label)

        // Save notify-pending for publication notification
        await writeJson(supabase, 'medshare-posts', `notify-${label}.json`, {
          postSubmissionId: id,
          scheduledTime: post.scheduledTime,
          titulo: post.titulo,
        })

        console.log(`Post ${label} scheduled: ${id}`)
      } catch (e) {
        console.error(`Failed to schedule ${label}:`, e)
        errors.push(label)
      }
    }

    // Format confirmation message
    const formatDate = (iso: string) => {
      const d = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000)
      return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) +
        ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }

    let msg = confirmed.length > 0
      ? `Agendado! ✅\n\n` + confirmed.map(l => {
          const p = posts[l as keyof WeeklyPosts]!
          return `*${l}* — ${p.titulo}\n📅 ${formatDate(p.scheduledTime)}`
        }).join('\n\n')
      : ''

    if (errors.length > 0) msg += `\n\nErro ao agendar: ${errors.join(', ')}`

    // Clean up if all confirmed or discarded
    const remaining = (['A','B','C'] as const).filter(l =>
      !labels.includes(l) && posts[l]
    )
    if (remaining.length === 0) {
      await deleteFile(supabase, 'medshare-posts', 'weekly-posts.json')
    } else {
      // Update weekly-posts.json removing confirmed ones
      const updated: WeeklyPosts = {}
      for (const l of remaining) updated[l] = posts[l]
      await writeJson(supabase, 'medshare-posts', 'weekly-posts.json', updated)
    }

    await sendText(ownerPhone, msg)
  }

  return new Response('OK', { status: 200 })
})
