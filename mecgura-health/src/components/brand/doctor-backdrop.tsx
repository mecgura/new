/**
 * Decorative background: a faint pattern of medical line icons plus an ECG trace, drawn here as original SVG (no stock images,
 * no third-party artwork). It sits behind the glass panels, ignores pointer events and is hidden from assistive technology.
 * Colour follows the clinic's brand colour; diagnostic centres get lab motifs (test tube, microscope) instead of doctor ones.
 */
type Variant = "doctor" | "lab";

const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** 48x48 icon cells. */
function Icons({ variant }: { variant: Variant }) {
  return (
    <>
      <symbol id="mh-cross" viewBox="0 0 48 48"><path {...STROKE} d="M19 6h10v13h13v10H29v13H19V29H6V19h13z" /></symbol>
      <symbol id="mh-heart" viewBox="0 0 48 48"><path {...STROKE} d="M24 41C10 31 6 24 6 17.5 6 12 10 8 15 8c3.8 0 7 2.2 9 5.500C26 10.200 29.2 8 33 8c5 0 9 4 9 9.500C42 24 38 31 24 41z" /><path {...STROKE} d="M10 22h8l3-6 5 11 3-5h9" /></symbol>
      <symbol id="mh-pill" viewBox="0 0 48 48"><g transform="rotate(-40 24 24)"><rect {...STROKE} x="6" y="15" width="36" height="18" rx="9" /><path {...STROKE} d="M24 15v18" /></g></symbol>
      <symbol id="mh-stetho" viewBox="0 0 48 48"><path {...STROKE} d="M12 6v14a8 8 0 0 0 16 0V6M10 6h4M26 6h4M20 28v4a8 8 0 0 0 16 0v-3" /><circle {...STROKE} cx="36" cy="25" r="4" /></symbol>
      <symbol id="mh-tube" viewBox="0 0 48 48"><path {...STROKE} d="M18 6h12M20 6v26a6 6 0 0 0 12 0V6M20 20h12" /></symbol>
      <symbol id="mh-scope" viewBox="0 0 48 48"><path {...STROKE} d="M26 6l8 10M22 12l8 10M14 38h22M20 38a10 10 0 0 0 10-10M18 26l8-14" /></symbol>
      <symbol id="mh-drop" viewBox="0 0 48 48"><path {...STROKE} d="M24 6c8 10 12 16 12 22a12 12 0 0 1-24 0c0-6 4-12 12-22z" /></symbol>
      {variant === "lab" ? null : <symbol id="mh-bag" viewBox="0 0 48 48"><path {...STROKE} d="M8 16h32v22a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4zM18 16v-4a6 6 0 0 1 12 0v4M24 24v10M19 29h10" /></symbol>}
    </>
  );
}

const DOCTOR = ["mh-stetho", "mh-cross", "mh-pill", "mh-heart", "mh-drop", "mh-bag"];
const LAB = ["mh-tube", "mh-scope", "mh-drop", "mh-cross", "mh-heart", "mh-pill"];

export function DoctorBackdrop({ variant = "doctor" }: { variant?: Variant }) {
  const set = variant === "lab" ? LAB : DOCTOR;
  // Staggered 3x2 tile (icons spaced ~110px, whole tile 330x220) rotated slightly so it never looks like a grid.
  const cells = set.map((id, i) => ({ id, x: 14 + (i % 3) * 110 + (i >= 3 ? 55 : 0), y: i < 3 ? 14 : 124 }));
  return (
    <div aria-hidden="true" className="doctor-backdrop pointer-events-none fixed inset-0 -z-10 overflow-hidden text-primary">
      <svg className="absolute inset-0 size-full" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <defs>
          <Icons variant={variant} />
          <pattern id="mh-tile" width="330" height="236" patternUnits="userSpaceOnUse" patternTransform="rotate(-14)">
            {cells.map((c) => <use key={`${c.id}-${c.x}-${c.y}`} href={`#${c.id}`} x={c.x} y={c.y} width="48" height="48" />)}
          </pattern>
          <linearGradient id="mh-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="white" stopOpacity="1" /><stop offset="1" stopColor="white" stopOpacity="0.35" /></linearGradient>
          <mask id="mh-mask"><rect width="100%" height="100%" fill="url(#mh-fade)" /></mask>
        </defs>
        <rect width="100%" height="100%" fill="url(#mh-tile)" opacity="0.09" mask="url(#mh-mask)" />
      </svg>
      {/* ECG trace along the bottom edge */}
      <svg className="absolute inset-x-0 bottom-0 h-40 w-full opacity-[0.09]" viewBox="0 0 1200 160" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
        <path fill="none" stroke="currentColor" strokeWidth="2.500" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
          d="M0 100h210l16-26 16 26h46l14-70 20 130 18-60h60l16-30 16 30h130l16-26 16 26h46l14-70 20 130 18-60h140l16-30 16 30h100" />
      </svg>
    </div>
  );
}
