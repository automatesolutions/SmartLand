// A calendar file (.ics) for a booked call, made in the browser. Google Calendar, Apple
// Calendar, and Outlook all open it. Nothing is sent anywhere.

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

// Commas, semicolons, and backslashes are special in .ics text
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => `\\${c}`).replace(/\r?\n/g, '\\n')

export function downloadCall({ id, title, startsAt, minutes = 30, details, url }: {
  id: string
  title: string
  startsAt: string
  minutes?: number
  details: string
  url: string
}) {
  const start = new Date(startsAt)
  const end = new Date(start.getTime() + minutes * 60_000)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SmartLand//Calls//EN',
    'BEGIN:VEVENT',
    `UID:${id}@smartland`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${text(title)}`,
    `DESCRIPTION:${text(`${details}\n${url}`)}`,
    `URL:${url}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${text(title)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'smartland-call.ics'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** A datetime-local input's value ("2026-12-02T15:00") as an ISO time, read in this device's time zone */
export const fromLocalInput = (value: string) => new Date(value).toISOString()

/** The earliest value a datetime-local input should allow: now, rounded up to the next 5 minutes */
export function nowForInput(): string {
  const d = new Date(Math.ceil(Date.now() / 300_000) * 300_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
