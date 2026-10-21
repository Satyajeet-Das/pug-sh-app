import { atomWithStorage } from 'jotai/utils'

// Build-time gate for the sign-in page's "Explore the live demo" link, driven by VITE_DEMO_ENABLED.
// It does NOT gate the /demo route itself (which always runs and surfaces the backend's Unavailable
// response when the demo is off), nor the in-app demo banner (that follows the active demo session:
// see isDemoSessionAtom). The real switch is the server's PUG_DEMO_ENABLED; this flag only decides
// whether to advertise the demo from sign-in in this build.
export function isDemoEnabled() {
  return (import.meta.env.VITE_DEMO_ENABLED ?? '').trim() === 'true'
}

// A host:port with no scheme parses as a scheme of its own, whose origin is the string 'null'.
const originOf = (value: string | undefined) => {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : ''
  } catch {
    return ''
  }
}

// Off unless both are set and differ: equal ones would make the app the demo host and take its sign-in away.
const demoOrigins = () => {
  const demo = originOf(import.meta.env.VITE_DEMO_ORIGIN)
  const app = originOf(import.meta.env.VITE_APP_ORIGIN)
  return demo && app && demo !== app ? { demo, app } : null
}

if ((import.meta.env.VITE_DEMO_ORIGIN || import.meta.env.VITE_APP_ORIGIN) && !demoOrigins()) {
  console.warn(
    '[demo] VITE_DEMO_ORIGIN and VITE_APP_ORIGIN need two different http(s) origins, so the demo stays on this origin. Set both or neither.',
  )
}

export const isDemoHost = () => demoOrigins()?.demo === window.location.origin

export const appOrigin = () => demoOrigins()?.app

// Keeps the query: it carries campaign tags.
export const demoHandoffUrl = () => {
  const origins = demoOrigins()
  if (!origins || isDemoHost()) return null
  return `${origins.demo}/${window.location.search}${window.location.hash}`
}

// Marks the current session as the read-only demo viewer. The demo access token is an ordinary
// viewer JWT, indistinguishable from a real viewer login since the role is never in the JWT (by
// design), so this frontend-only flag is what lets the UI show the demo banner and detect an
// already-active demo on the /demo page. Persisted so a reload mid-demo keeps the banner. Written by
// applySessionAtom, derived from the sign-in method in the same pass as the token: a demo login (via
// demoSignInAtom, method 'demo') sets it and every other real sign-in clears it; also cleared on
// sign-out and when a session dies via clearSession (failed refresh).
//
// getOnInit is what makes the flag true on the *first* render of a reload rather than one render
// later: atomWithStorage otherwise starts at the default and only reads storage on mount, and a
// consumer that acts in its first effect acts on `false`. Analytics is exactly that consumer: a
// demo reload would identify the shared demo account before the real value landed, which is the one
// thing the demo must never do (see analytics/identity.tsx). The JWT atoms take the same care by
// seeding from a synchronous read; this is the same fix spelled with the option.
export const isDemoSessionAtom = atomWithStorage('pug:isDemo', false, undefined, { getOnInit: true })
