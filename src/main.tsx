import React, { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/instrument-serif/latin-400.css'
import '@fontsource/instrument-serif/latin-400-italic.css'
import './base.css'

const Surface =
  /^\/admin(?:\/|$)/.test(location.pathname) &&
  !/^\/admin\/wall(?:\/|$)/.test(location.pathname)
    ? lazy(() => import('./Admin'))
    : lazy(() => import('./Wall'))

createRoot(document.getElementById('root')!).render(
  <Suspense
    fallback={
      <main aria-busy="true" className="loading-wall">
        Opening the wall…
      </main>
    }
  >
    <Surface />
  </Suspense>,
)
