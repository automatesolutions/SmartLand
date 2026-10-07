import type { AnalyzeInput } from './api'

export type FactorKey = Exclude<keyof AnalyzeInput['data'], 'news_text'>

export interface FactorSpec {
  key: FactorKey
  label: string
  hint: string
  min: number
  max: number
  step: number
  unit?: string
  group: 'area' | 'access'
}

// Ranges match what the AI service scores against (ai-microservice/main.py)
export const FACTORS: FactorSpec[] = [
  { key: 'infrastructure_score', label: 'Infrastructure', hint: 'Roads, power, water, and transport. 0 is none, 10 is complete.', min: 0, max: 10, step: 0.5, group: 'area' },
  { key: 'typhoon_risk', label: 'Typhoon and flood risk', hint: '0 is rarely hit, 10 is hit most years.', min: 0, max: 10, step: 0.5, group: 'area' },
  { key: 'gdp_growth', label: 'Local economic growth', hint: 'Yearly GDP growth for the region.', min: 0, max: 15, step: 0.1, unit: '%', group: 'area' },
  { key: 'population_growth', label: 'Population growth', hint: 'Yearly population growth for the city or town.', min: 0, max: 10, step: 0.1, unit: '%', group: 'area' },
  { key: 'proximity_to_mall', label: 'Nearest mall', hint: 'Driving distance to the closest mall.', min: 0, max: 30, step: 0.5, unit: 'km', group: 'access' },
  { key: 'proximity_to_school', label: 'Nearest school', hint: 'Distance to the closest school.', min: 0, max: 20, step: 0.5, unit: 'km', group: 'access' },
  { key: 'proximity_to_hospital', label: 'Nearest hospital', hint: 'Distance to the closest hospital.', min: 0, max: 30, step: 0.5, unit: 'km', group: 'access' },
  { key: 'distance_to_amenities', label: 'Town center', hint: 'Distance to shops, banks, and the public market.', min: 0, max: 30, step: 0.5, unit: 'km', group: 'access' },
]

export const DEFAULT_DATA: AnalyzeInput['data'] = {
  infrastructure_score: 5,
  typhoon_risk: 5,
  gdp_growth: 5,
  population_growth: 2,
  proximity_to_mall: 5,
  proximity_to_school: 3,
  proximity_to_hospital: 4,
  distance_to_amenities: 5,
  news_text: '',
}

// Starting points only. People should replace them with what they know.
export const PRESETS: { name: string; data: Omit<AnalyzeInput['data'], 'news_text'> }[] = [
  { name: 'Metro Manila', data: { infrastructure_score: 8.5, typhoon_risk: 6, gdp_growth: 6.5, population_growth: 1.5, proximity_to_mall: 1.5, proximity_to_school: 1, proximity_to_hospital: 2, distance_to_amenities: 1.5 } },
  { name: 'Cebu City', data: { infrastructure_score: 7.5, typhoon_risk: 5.5, gdp_growth: 6, population_growth: 2, proximity_to_mall: 2, proximity_to_school: 1.5, proximity_to_hospital: 2.5, distance_to_amenities: 2 } },
  { name: 'Davao City', data: { infrastructure_score: 7, typhoon_risk: 2, gdp_growth: 6.5, population_growth: 2.5, proximity_to_mall: 3, proximity_to_school: 1.5, proximity_to_hospital: 3, distance_to_amenities: 3 } },
  { name: 'Iloilo City', data: { infrastructure_score: 6.5, typhoon_risk: 5, gdp_growth: 5.5, population_growth: 1.8, proximity_to_mall: 3, proximity_to_school: 2, proximity_to_hospital: 3, distance_to_amenities: 3 } },
  { name: 'Rural lot', data: { infrastructure_score: 3, typhoon_risk: 7, gdp_growth: 3, population_growth: 1, proximity_to_mall: 18, proximity_to_school: 4, proximity_to_hospital: 15, distance_to_amenities: 12 } },
]

export const PLACE_SUGGESTIONS = [
  'Metro Manila', 'Quezon City', 'Makati', 'Taguig', 'Pasig', 'Cebu City', 'Mandaue', 'Lapu-Lapu',
  'Davao City', 'Iloilo City', 'Bacolod', 'Cagayan de Oro', 'General Santos', 'Baguio', 'Tagaytay',
  'Batangas City', 'Lipa', 'Calamba', 'Santa Rosa', 'Antipolo', 'Angeles', 'Clark', 'San Fernando',
  'Puerto Princesa', 'Dumaguete', 'Tacloban', 'Zamboanga City', 'Butuan', 'Legazpi', 'Naga',
]
