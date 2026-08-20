interface IconProps {
  className?: string;
}

const BASE_PROPS = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function MoreIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MuteIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <polygon points="4,9 8,9 12.5,5 12.5,19 8,15 4,15" fill="currentColor" stroke="none" />
      <line x1="16" y1="9" x2="21" y2="15" />
      <line x1="21" y1="9" x2="16" y2="15" />
    </svg>
  );
}

export function UnmuteIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <polygon points="4,9 8,9 12.5,5 12.5,19 8,15 4,15" fill="currentColor" stroke="none" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M4 7h16" />
      <path d="M9 7V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V7" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  );
}

export function DuplicateIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <rect x="4" y="4" width="12" height="12" rx="1.5" />
      <path d="M9 20h9a1.5 1.5 0 0 0 1.5-1.5V9" />
    </svg>
  );
}

export function InsertBeforeIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <line x1="6" y1="4" x2="6" y2="20" />
      <line x1="11" y1="12" x2="21" y2="12" />
      <line x1="14" y1="8" x2="21" y2="8" />
      <line x1="14" y1="16" x2="21" y2="16" />
    </svg>
  );
}

export function InsertAfterIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <line x1="18" y1="4" x2="18" y2="20" />
      <line x1="3" y1="12" x2="13" y2="12" />
      <line x1="3" y1="8" x2="10" y2="8" />
      <line x1="3" y1="16" x2="10" y2="16" />
    </svg>
  );
}

export function MoveLeftIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <line x1="4" y1="12" x2="19" y2="12" />
      <polyline points="9,6 4,12 9,18" />
    </svg>
  );
}

export function MoveRightIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <line x1="5" y1="12" x2="20" y2="12" />
      <polyline points="15,6 20,12 15,18" />
    </svg>
  );
}

export function ReplaceIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M4 12a8 8 0 0 1 13.5-5.7L20 8" />
      <polyline points="20,3 20,8 15,8" />
      <path d="M20 12a8 8 0 0 1-13.5 5.7L4 16" />
      <polyline points="4,21 4,16 9,16" />
    </svg>
  );
}

export function SplitIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="3 3" />
      <path d="M5 7h3l3 5-3 5H5" />
      <path d="M19 7h-3l-3 5 3 5h3" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <line x1="5" y1="5" x2="19" y2="19" />
      <line x1="19" y1="5" x2="5" y2="19" />
    </svg>
  );
}

export function VideoGlyphIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <rect x="3" y="6" width="13" height="12" rx="1.5" />
      <path d="M16 10.5l5-3v9l-5-3z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AudioGlyphIcon({ className }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M4 10v4" />
      <path d="M8 7v10" />
      <path d="M12 4v16" />
      <path d="M16 7v10" />
      <path d="M20 10v4" />
    </svg>
  );
}
