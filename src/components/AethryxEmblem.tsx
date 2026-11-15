export function AethryxEmblem({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <circle cx="18" cy="18" r="15" stroke="#1E293B" strokeWidth="1.25" />
      <ellipse
        cx="18"
        cy="18"
        rx="14"
        ry="6"
        transform="rotate(-28 18 18)"
        stroke="#06B6D4"
        strokeWidth="1.35"
      />
      <ellipse
        cx="18"
        cy="18"
        rx="14"
        ry="6"
        transform="rotate(28 18 18)"
        stroke="#38BDF8"
        strokeOpacity="0.45"
        strokeWidth="1"
      />
      <circle cx="18" cy="18" r="5.5" stroke="#E2E8F0" strokeWidth="1.25" />
      <circle cx="18" cy="18" r="2" fill="#06B6D4" />
      <line x1="18" y1="1.5" x2="18" y2="5.5" stroke="#06B6D4" strokeWidth="1.25" />
      <line x1="18" y1="30.5" x2="18" y2="34.5" stroke="#06B6D4" strokeWidth="1.25" />
    </svg>
  );
}
