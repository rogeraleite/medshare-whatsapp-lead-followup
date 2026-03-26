# MedShare WhatsApp Lead Follow-up

Automated WhatsApp drip sequence for MedShare leads. When a potential lead is captured (via landing page or manually), the system sends personalized follow-up messages at scheduled intervals and stops as soon as the lead replies.

## How it works

1. A lead is registered by sending a WhatsApp message to the MedShare number with the prefix `Potencial Lead:` followed by CSV data.
2. The owner receives a notification on their personal WhatsApp with lead details and a suggested first message.
3. The owner approves (or rewrites) the message via a 2-step confirmation flow.
4. Once approved, the message is sent to the lead. Follow-up messages are sent automatically at +1d, +3d, +7d, and +14d.
5. If the lead replies at any point, the sequence stops and the owner is notified.

## Message sequence

| Step | Delay | Type       | Description                     |
|------|-------|------------|---------------------------------|
| 0    | immed | text       | First contact (owner-approved)  |
| 1    | +1d   | text       | Reminder                        |
| 2    | +3d   | video link | Demo video                      |
| 3    | +7d   | text       | Pain-point personalization      |
| 4    | +14d  | text       | Last contact                    |

## Lead registration format

Send to the MedShare WhatsApp number:

```
Potencial Lead: Nome Completo, 51999998888, Cargo, Volume de procedimentos, Descricao dos problemas
```

- Phone: Brazilian numbers only need DDD + number (country code `55` is added automatically). International numbers should include country code with `+`.
- Problems field may contain commas.

## Owner approval flow

When a new lead is registered:

1. Owner receives a notification with lead details and a suggested message.
2. Owner replies `sim` to use the suggested message, or types a custom message.
3. Owner receives a confirmation showing exactly what will be sent.
4. Owner replies `sim` to confirm and send. Any other reply updates the message content and requests re-confirmation.

## Architecture

```
FlutterFlow (lead form)
    |
    v
MedShare WhatsApp number (Zapster instance)
    |
    v
whatsapp-webhook (Supabase Edge Function)
    |-- "Potencial Lead:" --> registerLead() --> DB + owner notification
    |-- Owner reply ------> handleOwnerReply() --> approval flow
    `-- Lead reply -------> mark replied, stop sequence, notify owner

process-due-messages (Supabase Edge Function)
    ^
    |
pg_cron (every minute) --> sends pending sequence messages
```

## Stack

- **Supabase** (free tier): PostgreSQL, Edge Functions (Deno), pg_cron, pg_net
- **Zapster API**: WhatsApp sending/receiving
- **FlutterFlow**: Lead capture form (sends trigger message)

## Project structure

```
supabase/
  migrations/
    20260326000000_initial_schema.sql   # DB schema + default templates
  functions/
    _shared/
      templates.ts                      # Lead type, template rendering
    whatsapp-webhook/
      index.ts                          # Inbound webhook handler
    process-due-messages/
      index.ts                          # Cron-triggered message sender
    lead-intake/
      index.ts                          # Direct HTTP lead registration (optional)
```

## Environment variables

Set via `supabase secrets set`:

| Variable                | Description                                      |
|-------------------------|--------------------------------------------------|
| `SUPABASE_URL`          | Supabase project URL                             |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS)             |
| `ZAPSTER_API_URL`       | `https://new-api.zapsterapi.com/v1`              |
| `ZAPSTER_TOKEN`         | Zapster JWT token                                |
| `ZAPSTER_INSTANCE_ID`   | Zapster WhatsApp instance ID                     |
| `MEDSHARE_SENDER_PHONE` | MedShare WhatsApp number (outbound echo ignored) |
| `OWNER_PHONE`           | Owner personal number (receives all alerts)      |

Copy `.env.local` to configure locally. Never commit this file.

## Setup

### 1. Deploy database

```bash
supabase link --project-ref <project-ref>
supabase db push
```

### 2. Set secrets

```bash
supabase secrets set \
  ZAPSTER_API_URL=https://new-api.zapsterapi.com/v1 \
  ZAPSTER_TOKEN=<token> \
  ZAPSTER_INSTANCE_ID=<instance-id> \
  MEDSHARE_SENDER_PHONE=<number> \
  OWNER_PHONE=<number>
```

### 3. Deploy Edge Functions

```bash
supabase functions deploy whatsapp-webhook --no-verify-jwt
supabase functions deploy process-due-messages
```

### 4. Configure pg_cron

Run in Supabase SQL Editor (see comment at the bottom of the migration file):

```sql
select cron.schedule(
  'process-due-messages',
  '* * * * *',
  $$
    select net.http_post(
      url     := 'https://<project-ref>.supabase.co/functions/v1/process-due-messages',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb
    );
  $$
);
```

### 5. Register webhook in Zapster

Set the webhook URL to:

```
https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook
```

Event: **Mensagem Recebida**

## Message templates

Templates are stored in the `message_templates` table and support these placeholders:

| Placeholder        | Value                           |
|--------------------|---------------------------------|
| `{{first_name}}`   | Lead's first name               |
| `{{role}}`         | Mapped role label               |
| `{{procedures}}`   | procedures_per_month field      |
| `{{problems}}`     | problems field                  |

To update templates, edit the rows directly in Supabase Table Editor or via SQL.
