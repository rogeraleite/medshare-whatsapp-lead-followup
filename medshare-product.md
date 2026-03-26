# MedShare - Product Knowledge Base

## Posicionamento
"O MedShare é o sistema que organiza a vida operacional e financeira de médicos freelancers e pequenos grupos, substituindo WhatsApp, planilhas e processos manuais por um fluxo simples e centralizado."

## Público-alvo
- **Primário:** Anestesistas freelancers ("frilas") e pequenos grupos de anestesia/cirurgia
- **Secundário:** Clínicas pequenas, outras especialidades médicas com dinâmica similar
- Insight: maior aderência inicial em mercados com alta concentração de freelancers (ex: Rio de Janeiro)

## Dores principais que o produto resolve
1. Comunicação descentralizada (principalmente via WhatsApp)
2. Falta de controle financeiro claro
3. Processos manuais repetitivos (registro de procedimentos, faturamento)
4. Dificuldade em organizar documentos e comprovantes
5. Baixa padronização entre membros do grupo
6. Pouca visibilidade sobre produção individual e coletiva

## Funcionalidades principais
- Registro de procedimentos cirúrgicos (tickets cirúrgicos)
- Controle financeiro: relatórios, múltiplos tipos de pagamento, geração de NF
- Documentos: upload e envio seguro para pacientes
- Comunicação: integração WhatsApp, compartilhamento entre membros
- Gestão de grupos: papéis (Médico, Contador, Admin)
- Busca avançada com Algolia
- Ficha de anestesia digital com geração de PDF

## Diferenciais
- Foco específico em grupos médicos pequenos (não é genérico)
- Combinação de operação clínica + financeiro + comunicação
- Configuração em menos de 5 minutos
- LGPD compliant, servidores no Brasil

## Planos
- **Starter (Free):** até 50 procedimentos/mês, 2 usuários, 500MB storage, R$ 200 setup
- **Pro:** pricing customizado, ilimitado

## Objeções comuns (validadas em entrevistas)
- Sensibilidade a preço
- Necessidade de confiança/credibilidade
- Importância de venda relacional (contato humano)
- Resistência à mudança (acostumados com WhatsApp)

## URL e contato
- App: https://medshare.app
- Landing: https://medshare-landingpage.vercel.app/
- Email: contato@medshare.app
- WhatsApp Medshare: +55 51 27970539

## Campos do lead (coletados no formulário)
- name: nome completo
- phone: número WhatsApp com DDI (ex: 5511999998888)
- role: cargo (anestesista_frila | anestesista_grupo | cirurgiao | admin_contador | outro)
- group_size: tamanho do grupo (solo | 2_5 | 5_15 | 15_mais)
- problems: array de dores selecionadas (control_financeiro | gestao_documentos | comunicacao | faturamento_nf | visibilidade_producao | outro)
- source: origem do lead (landing_page | indicacao | outro)
