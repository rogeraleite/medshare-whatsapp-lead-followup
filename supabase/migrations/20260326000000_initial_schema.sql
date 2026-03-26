-- Enable pg_cron and http extensions
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================
-- LEADS
-- ============================================================
create table leads (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  phone                text not null unique,   -- E.164 without +, e.g. 5551999998888
  role                 text,
  procedures_per_month text,
  problems             text,
  source               text default 'landing_page',
  status               text not null default 'active',  -- active | replied | stopped
  created_at           timestamptz not null default now()
);

-- ============================================================
-- MESSAGE TEMPLATES
-- Placeholders: {{first_name}}, {{role}}, {{procedures}}, {{problems}}
-- ============================================================
create table message_templates (
  id           serial primary key,
  step         int not null unique,
  delay_days   int not null,
  message_type text not null,   -- text | audio | video_link
  body         text not null,
  caption      text,
  description  text
);

insert into message_templates (step, delay_days, message_type, body, caption, description) values
(
  0, 0, 'text',
  'Oi {{first_name}}! Aqui é o Roger do MedShare 👋

Vi que você demonstrou interesse no sistema — obrigado pelo contato!

O MedShare foi feito pra {{role}}: centraliza procedimentos, financeiro e documentos em um lugar só, sem planilha e sem WhatsApp bagunçado.

Posso te mostrar como funciona numa demo rápida de 15 min? É só me responder aqui com um horário que funciona pra você.',
  null,
  'Primeiro contato imediato'
),
(
  1, 1, 'text',
  'Oi {{first_name}}, tudo bem?

Passando pra lembrar que tenho um horário disponível pra te apresentar o MedShare.

Com {{procedures}} por mês, imagino que controle e organização fazem muita diferença no dia a dia. É exatamente isso que o sistema resolve.

Me responde aqui e a gente marca uma conversa rápida!',
  null,
  'Follow-up dia 1'
),
(
  2, 3, 'video_link',
  'Oi {{first_name}}! Sei que a rotina é corrida, então gravei um vídeo curto mostrando o MedShare na prática 👇

https://www.youtube.com/shorts/J1ZtGnnmegA

Vale os 60 segundos! Qualquer dúvida é só responder.',
  null,
  'Follow-up dia 3 - vídeo demo'
),
(
  3, 7, 'text',
  'Oi {{first_name}}, uma pergunta rápida:

Você mencionou que quer resolver: _{{problems}}_

O MedShare resolve isso de forma direta. Quer que eu te mostre especificamente como?

Me responde aqui, leva 15 minutos e pode fazer diferença real na sua operação.',
  null,
  'Follow-up dia 7 - personalizado pela dor'
),
(
  4, 14, 'text',
  'Oi {{first_name}}, última mensagem, prometo! 😄

Se em algum momento fizer sentido organizar melhor a operação do seu grupo, o MedShare está aqui.

Qualquer dúvida é só responder. Abraço!',
  null,
  'Follow-up dia 14 - último contato'
);

-- ============================================================
-- SEQUENCE MESSAGES
-- status values:
--   pending            → scheduled, will be auto-sent by cron
--   awaiting_approval  → step 0 waiting for owner approval
--   awaiting_confirm   → owner gave content, waiting for final "sim"
--   sent               → sent successfully
--   skipped            → lead replied, cancelled
--   failed             → sending error
-- ============================================================
create table sequence_messages (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references leads(id) on delete cascade,
  step         int not null,
  scheduled_at timestamptz not null,
  sent_at      timestamptz,
  status       text not null default 'pending',
  error        text,
  created_at   timestamptz not null default now(),
  unique(lead_id, step)
);

create index idx_sequence_messages_due
  on sequence_messages(scheduled_at, status)
  where status = 'pending';

-- ============================================================
-- PENDING APPROVALS
-- Tracks owner approval flow for step 0 messages
-- ============================================================
create table pending_approvals (
  id                  uuid primary key default gen_random_uuid(),
  sequence_message_id uuid not null references sequence_messages(id) on delete cascade,
  lead_id             uuid not null references leads(id) on delete cascade,
  suggested_message   text not null,
  final_message       text,   -- set after owner's first reply
  created_at          timestamptz not null default now()
);

-- ============================================================
-- INBOUND MESSAGES
-- ============================================================
create table inbound_messages (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references leads(id) on delete set null,
  phone       text not null,
  body        text,
  received_at timestamptz not null default now()
);

-- ============================================================
-- pg_cron: every minute, call process-due-messages
-- Run this in Supabase SQL editor after deploy:
--
-- select cron.schedule(
--   'process-due-messages',
--   '* * * * *',
--   $$
--     select net.http_post(
--       url     := 'https://tycselnwkwufcvhpygee.supabase.co/functions/v1/process-due-messages',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
--         'Content-Type', 'application/json'
--       ),
--       body    := '{}'::jsonb
--     );
--   $$
-- );
-- ============================================================
