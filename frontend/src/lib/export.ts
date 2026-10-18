import type { Report } from './reports'
import { FACTORS } from './presets'
import { splitInsights } from './format'

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function download(filename: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report'
}

/** One field per row, so it opens cleanly in Excel or Google Sheets */
export function downloadCsv(report: Report) {
  const { result, input } = report
  const place = result.geo_data
  const rows: [string, unknown][] = [
    ['Location', result.location],
    ['Found as', place?.display_name],
    ['Latitude', place?.lat],
    ['Longitude', place?.lon],
    ['Elevation (m)', place?.elevation_m],
    ['Report date', report.createdAt],
    ['Price per sqm (PHP)', result.predicted_price_sqm],
    ['Likely low (PHP/sqm)', result.price_low],
    ['Likely high (PHP/sqm)', result.price_high],
    ['Confidence', result.confidence],
    ['Growth score', result.growth_score],
    ['Grade', result.category],
    ...FACTORS.map((f): [string, unknown] => [`${f.label}${f.unit ? ` (${f.unit})` : ' (0-10)'}`, input.data[f.key]]),
    ...(result.comps ?? []).map((c): [string, unknown] => [
      `Reference area: ${c.name}, ${c.distance_km} km`,
      `${c.price_low}-${c.price_high}`,
    ]),
    ...splitInsights(result.insights).map((text, i): [string, unknown] => [`Reason ${i + 1}`, text]),
  ]
  const csv = ['Field,Value', ...rows.map(([k, v]) => `${csvCell(k)},${csvCell(v)}`)].join('\n')
  download(`smartland-${slug(result.location)}.csv`, 'text/csv;charset=utf-8', `﻿${csv}`)
}

export function printReport() {
  window.print()
}
