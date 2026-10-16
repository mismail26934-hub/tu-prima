'use client';

import { useLayoutEffect, type ReactNode } from 'react';

/** Figma Responsive Layout — Desktop breakpoint >1240 (node 2:4146). */
const DESKTOP_MIN = 1240;
/** Figma Responsive Layout — Tablet breakpoint >600. */
const TABLET_MIN = 600;

type DsDevice = 'phone' | 'tablet' | 'desktop';

function deviceForWidth(width: number): DsDevice {
  if (width >= DESKTOP_MIN) return 'desktop';
  if (width >= TABLET_MIN) return 'tablet';
  return 'phone';
}

/**
 * Fluid shell — Phone / Tablet / Desktop use real screen margins from
 * `--ds-margin` (16 / 32 / 64). No 1440px scale transform.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    const apply = () => {
      const width = document.documentElement.clientWidth;
      document.documentElement.dataset.dsDevice = deviceForWidth(width);
      document.documentElement.classList.remove('is-framed');
      document.documentElement.style.removeProperty('--app-scale');
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      document.documentElement.removeAttribute('data-ds-device');
      document.documentElement.classList.remove('is-framed');
      document.documentElement.style.removeProperty('--app-scale');
    };
  }, []);

  return <div className='app-stage'>{children}</div>;
}
