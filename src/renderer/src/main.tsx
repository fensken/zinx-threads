import './assets/globals.css'
import './store/theme-store' // applies the persisted/default theme before first render
import './store/settings-store' // applies the persisted UI scale (root font-size) before first render

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
