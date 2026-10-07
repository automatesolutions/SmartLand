export type Tone = 'positive' | 'caution' | 'critical'

export interface Grade {
  grade: string
  label: string
  tone: Tone
  summary: string
}

// Maps the AI service's category strings (ai-microservice/main.py) to display data
const GRADES: Record<string, Omit<Grade, 'grade'>> = {
  'A+': { label: 'Prime investment', tone: 'positive', summary: 'Strong growth signals and good access. Prices here tend to rise fastest.' },
  'A to B+': { label: 'High growth', tone: 'positive', summary: 'Solid fundamentals with planned infrastructure on the way.' },
  'B to C': { label: 'Moderate growth', tone: 'caution', summary: 'Room to grow, with more risk. Better for long holds.' },
  'C-': { label: 'High risk', tone: 'critical', summary: 'Weak growth signals or high hazard exposure. Check carefully before you buy.' },
}

export const GRADE_ORDER = ['A+', 'A to B+', 'B to C', 'C-'] as const

export function parseGrade(category: string): Grade {
  const grade = category.split(' (')[0].trim()
  const known = GRADES[grade]
  if (known) return { grade, ...known }
  return { grade, label: category, tone: 'caution', summary: '' }
}

export function gradeInfo(grade: (typeof GRADE_ORDER)[number]): Grade {
  return { grade, ...GRADES[grade] }
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })

export function formatPeso(value: number): string {
  return peso.format(value)
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

// The AI service joins insights with " | "
export function splitInsights(insights: string | undefined | null): string[] {
  if (!insights) return []
  return insights
    .split(' | ')
    .map((s) => s.trim())
    .filter((s) => s.length > 1)
}

// Matches the warning lines in ai-microservice/main.py generate_insights
const RISK_WORDS = ['risk', 'weak', 'lacking', 'check', 'low prices']

export function insightTone(text: string): Tone {
  const t = text.toLowerCase()
  return RISK_WORDS.some((w) => t.includes(w)) ? 'caution' : 'positive'
}

export const toneText: Record<Tone, string> = {
  positive: 'text-positive',
  caution: 'text-caution',
  critical: 'text-critical',
}
