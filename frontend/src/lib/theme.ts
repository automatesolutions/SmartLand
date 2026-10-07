import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark'
const KEY = 'smartland:theme'

function readChoice(): ThemeChoice {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice)

  useEffect(() => {
    const root = document.documentElement
    if (choice === 'dark') root.dataset.theme = 'dark'
    else delete root.dataset.theme
    try {
      if (choice === 'dark') localStorage.setItem(KEY, 'dark')
      else localStorage.removeItem(KEY)
    } catch {
      // Storage blocked: the theme still applies for this visit
    }
  }, [choice])

  const cycle = useCallback(() => {
    setChoice((c) => (c === 'light' ? 'dark' : 'light'))
  }, [])

  return { choice, cycle }
}
