import { useEffect, useState } from 'react'
import { atom, createTLCurrentUser, getUserPreferences, react as reactSignal, setUserPreferences } from 'tldraw'

const DEFAULT_LOCALE = 'zh-cn'
const DEFAULT_LOCALE_MARKER = 'HICANVAS_DEFAULT_LOCALE_APPLIED_V1'

function hasAppliedDefaultLocale() {
  try { return window.localStorage.getItem(DEFAULT_LOCALE_MARKER) === '1' } catch { return false }
}

function markDefaultLocaleApplied() {
  try { window.localStorage.setItem(DEFAULT_LOCALE_MARKER, '1') } catch { /* 当前会话仍使用中文。 */ }
}

function createHiCanvasUser() {
  const storedPreferences = getUserPreferences()
  const shouldUseDefaultLocale = !hasAppliedDefaultLocale()
  const initialPreferences = shouldUseDefaultLocale ? { ...storedPreferences, locale: DEFAULT_LOCALE } : storedPreferences
  if (shouldUseDefaultLocale) {
    setUserPreferences(initialPreferences)
    markDefaultLocaleApplied()
  }
  const preferences = atom('hicanvas-user-preferences', initialPreferences)
  return createTLCurrentUser({
    userPreferences: preferences,
    setUserPreferences(nextPreferences) {
      preferences.set(nextPreferences)
      setUserPreferences(nextPreferences)
    }
  })
}

const hiCanvasUser = createHiCanvasUser()

function useHiCanvasLocale() {
  const [locale, setLocale] = useState(() => hiCanvasUser.userPreferences.get().locale || DEFAULT_LOCALE)
  useEffect(() => reactSignal('hicanvas locale', () => {
    setLocale(hiCanvasUser.userPreferences.get().locale || DEFAULT_LOCALE)
  }), [])
  return locale
}

export { hiCanvasUser, useHiCanvasLocale }
