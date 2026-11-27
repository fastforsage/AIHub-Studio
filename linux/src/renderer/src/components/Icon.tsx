import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1-1.8 3.1-.2-.1a1.6 1.6 0 0 0-1.7.6l-.1.2h-3.6l-.1-.2a1.6 1.6 0 0 0-1.7-.6l-.2.1-1.8-3.1.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.4-1l-.2 0v-3.6l.2 0a1.6 1.6 0 0 0 1.4-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1 1.8-3.1.2.1a1.6 1.6 0 0 0 1.7-.6l.1-.2h3.6l.1.2a1.6 1.6 0 0 0 1.7.6l.2-.1 1.8 3.1-.1.1a1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.4 1l.2 0v3.6l-.2 0a1.6 1.6 0 0 0-1.4 1Z" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  star: <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.3-5.7-3-5.7 3 1.1-6.3L2.9 9.6l6.3-.9L12 3Z" />,
  folder: <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  local: <><rect x="5" y="5" width="14" height="14" rx="3" /><rect x="9" y="9" width="6" height="6" rx="1" /><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3" /></>,
  close: <path d="M5 5l14 14M19 5 5 19" />,
  add: <path d="M12 4v16M4 12h16" />,
  spinner: <path d="M20 12a8 8 0 1 1-8-8" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  network: <><path d="M3 12h18M7 8l-4 4 4 4m10-8 4 4-4 4" /></>,
  appearance: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /></>,
  diagnostics: <><path d="M3 12h4l2-5 4 10 2-5h6" /><rect x="3" y="3" width="18" height="18" rx="3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></>
};

export function Icon({ name, size = 16 }: { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
