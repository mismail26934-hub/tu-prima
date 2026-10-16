'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Desktop composition width. The frame is scaled to the window instead of reflowing. */
const DESIGN_WIDTH = 1440;
/** Match the existing phone layout breakpoint. Below this, the page stays fluid. */
const DESKTOP_MIN = 801;

export function AppFrame({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [framed, setFramed] = useState(false);

  useLayoutEffect(() => {
    const apply = () => {
      const width = document.documentElement.clientWidth;
      const nextFramed = width >= DESKTOP_MIN;
      const nextScale = nextFramed ? Math.min(1, width / DESIGN_WIDTH) : 1;
      document.documentElement.classList.toggle('is-framed', nextFramed);
      document.documentElement.style.setProperty('--app-scale', String(nextScale));
      setFramed(nextFramed);
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      document.documentElement.classList.remove('is-framed');
      document.documentElement.style.removeProperty('--app-scale');
    };
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !framed) return;
    const onScroll = () => {
      document.documentElement.classList.toggle(
        'topbar-scrolled',
        el.scrollTop > 4
      );
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [framed]);

  return (
    <div className={framed ? 'app-stage is-framed' : 'app-stage'}>
      <div className='app-scale-slot'>
        <div className='app-frame'>
          <div className='app-scroll' ref={scrollRef}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
