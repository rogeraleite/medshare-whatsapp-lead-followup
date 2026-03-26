export interface Lead {
  id: string
  name: string
  phone: string
  role: string | null
  procedures_per_month: string | null
  problems: string | null
}

export function extractFirstName(fullName: string): string {
  return fullName.trim().split(' ')[0]
}

export function roleLabel(role: string | null): string {
  const map: Record<string, string> = {
    'Dono/Sócio do Grupo': 'dono de grupo médico',
    'Médico do Corpo Clínico': 'médico do corpo clínico',
    'Gestor Administrativo/Secretária': 'gestor administrativo',
    'Outro': 'médico',
  }
  return role ? (map[role] ?? role) : 'médico'
}

export function renderTemplate(template: string, lead: Lead): string {
  return template
    .replace(/\{\{first_name\}\}/g, extractFirstName(lead.name))
    .replace(/\{\{role\}\}/g, roleLabel(lead.role))
    .replace(/\{\{procedures\}\}/g, lead.procedures_per_month ?? 'seus procedimentos')
    .replace(/\{\{problems\}\}/g, lead.problems ?? 'organização e controle operacional')
}
