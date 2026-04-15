import { createClient } from 'jsr:@supabase/supabase-js@2'

interface NotifyPending {
  postSubmissionId: string
  scheduledTime: string
  titulo: string
}

const LABELS = ['A', 'B', 'C'] as const

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  for (const label of LABELS) {
    const path = `notify-${label}.json`

    const { data, error } = await supabase.storage
      .from('medshare-posts')
      .download(path)

    if (error || !data) continue

    let notify: NotifyPending
    try {
      notify = JSON.parse(await data.text())
    } catch {
      console.error(`Failed to parse ${path}`)
      continue
    }

    // Check post status on Blotato
    const res = await fetch(`https://backend.blotato.com/v2/posts/${notify.postSubmissionId}`, {
      headers: { 'blotato-api-key': Deno.env.get('BLOTATO_API_KEY')! },
    })

    if (!res.ok) {
      console.error(`Blotato status check failed for ${label}: ${res.status}`)
      continue
    }

    const { status } = await res.json() as { status: string }
    console.log(`Post ${label} "${notify.titulo}" status: ${status}`)

    if (status === 'published') {
      const ownerPhone = Deno.env.get('OWNER_PHONE')!
      await fetch(`${Deno.env.get('ZAPSTER_API_URL')}/wa/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('ZAPSTER_TOKEN')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: ownerPhone,
          instance_id: Deno.env.get('ZAPSTER_INSTANCE_ID'),
          text: `Post ${label} publicado no Instagram!\n\n*${notify.titulo}*`,
        }),
      })

      await supabase.storage.from('medshare-posts').remove([path])
      console.log(`Notification sent and ${path} cleaned up`)
    }
  }

  return new Response('OK', { status: 200 })
})
