import { incidents } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { ExternalLink, Maximize2 } from "lucide-react";

const severityDotColors: Record<number, string> = {
  1: "#4ead7a",
  2: "#e6a020",
  3: "#dd6020",
  4: "#cc2d1a",
};

const severityLabels: Record<number, string> = {
  1: "LOW",
  2: "MODERATE",
  3: "HIGH",
  4: "CRITICAL",
};

export function MapPreview() {
  return (
    <div className="flex flex-col bg-sentinel-card border border-sentinel-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-sentinel-border">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-sentinel-text">Live Map</h2>
          {/* LIVE badge */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-sm bg-severity-1/15 border border-severity-1/30">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-severity-1 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-severity-1" />
            </span>
            <span className="text-2xs font-bold text-severity-1 tracking-widest">LIVE</span>
          </div>
        </div>
        <a
          href="/map"
          className="flex items-center gap-1 text-xs text-sentinel-primary hover:text-sentinel-text transition-colors"
        >
          <Maximize2 className="w-3 h-3" />
          Full map
        </a>
      </div>

      {/* Map area */}
      <div className="relative flex-1 bg-[#0a0e14] overflow-hidden" style={{ minHeight: "280px" }}>
        {/* SVG topographic lines */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 400 300"
          preserveAspectRatio="xMidYMid slice"
        >
          {/* Grid lines */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1a2030" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Topographic contour lines - Kazakhstan-like terrain */}
          <g stroke="#1e2840" strokeWidth="0.8" fill="none" opacity="0.7">
            <ellipse cx="200" cy="150" rx="180" ry="120" />
            <ellipse cx="200" cy="150" rx="155" ry="100" />
            <ellipse cx="200" cy="150" rx="130" ry="82" />
            <ellipse cx="200" cy="150" rx="105" ry="65" />

            {/* Mountain ranges in south/east */}
            <path d="M 240 80 Q 280 60 320 90 Q 340 110 360 100" />
            <path d="M 250 95 Q 290 72 330 105 Q 348 122 368 110" />
            <path d="M 220 70 Q 260 50 300 80 Q 325 100 350 90" />

            {/* River lines */}
            <path d="M 80 60 Q 100 100 90 140 Q 85 170 100 200 Q 120 230 150 240" strokeDasharray="3,2" stroke="#1e3050" strokeWidth="1" />
            <path d="M 180 50 Q 200 80 210 120 Q 220 160 200 190" strokeDasharray="3,2" stroke="#1e3050" strokeWidth="1" />
          </g>

          {/* Country border hint */}
          <path
            d="M 30 100 Q 60 70 120 65 Q 180 60 240 75 Q 290 60 350 80 Q 380 100 390 140 Q 385 190 370 220 Q 340 250 290 260 Q 230 275 170 265 Q 100 255 60 230 Q 30 200 25 160 Q 20 130 30 100"
            stroke="#252d3d"
            strokeWidth="1.5"
            fill="#111827"
            fillOpacity="0.3"
          />

          {/* City dots */}
          <circle cx="272" cy="132" r="2" fill="#252d3d" />
          <text x="276" y="136" fontSize="6" fill="#374151" fontFamily="monospace">ALMATY</text>
          <circle cx="220" cy="105" r="2" fill="#252d3d" />
          <text x="224" y="109" fontSize="6" fill="#374151" fontFamily="monospace">ASTANA</text>
          <circle cx="72" cy="147" r="1.5" fill="#252d3d" />
          <text x="76" y="151" fontSize="5" fill="#374151" fontFamily="monospace">ATYRAU</text>
        </svg>

        {/* Incident markers */}
        {incidents.map((incident) => (
          <IncidentMarker key={incident.id} incident={incident} />
        ))}

        {/* Legend */}
        <div className="absolute bottom-3 left-3 bg-sentinel-card/90 border border-sentinel-border rounded-md p-2.5 backdrop-blur-sm">
          <p className="text-2xs font-semibold text-sentinel-subtle uppercase tracking-widest mb-1.5">Severity</p>
          <div className="flex flex-col gap-1">
            {([4, 3, 2, 1] as const).map((level) => (
              <div key={level} className="flex items-center gap-1.5">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: severityDotColors[level] }}
                />
                <span className="text-2xs text-sentinel-muted">{severityLabels[level]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Coordinates overlay */}
        <div className="absolute top-3 left-3 font-mono text-2xs text-sentinel-subtle/50">
          43.2°N 76.8°E
        </div>

        {/* Scale */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1">
          <div className="w-12 h-px bg-sentinel-muted/40" />
          <span className="font-mono text-2xs text-sentinel-subtle/60">200 km</span>
        </div>
      </div>
    </div>
  );
}

type IncidentItem = (typeof incidents)[number];

function IncidentMarker({ incident }: { incident: IncidentItem }) {
  const inc = incident;
  const color = severityDotColors[inc.severity];
  const isCritical = inc.severity === 4;

  return (
    <div
      className="absolute group"
      style={{
        left: `${inc.coords.x}%`,
        top: `${inc.coords.y}%`,
        transform: "translate(-50%, -50%)",
      }}
    >
      {/* Pulse ring for critical */}
      {isCritical && (
        <div
          className="absolute inset-0 rounded-full animate-ping"
          style={{
            width: "20px",
            height: "20px",
            backgroundColor: color,
            opacity: 0.3,
            transform: "translate(-25%, -25%)",
          }}
        />
      )}

      {/* Dot */}
      <div
        className={cn(
          "relative w-3.5 h-3.5 rounded-full border-2 cursor-pointer",
          "transition-transform group-hover:scale-125",
          isCritical && "map-dot-critical"
        )}
        style={{
          backgroundColor: color,
          borderColor: `${color}40`,
          boxShadow: `0 0 8px ${color}60`,
        }}
      />

      {/* Tooltip */}
      <div className={cn(
        "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48",
        "bg-sentinel-sidebar border border-sentinel-border rounded-md p-2 shadow-xl",
        "opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
      )}>
        <p className="font-mono text-xs text-sentinel-primary mb-1">{inc.code}</p>
        <p className="text-xs text-sentinel-text leading-tight">{inc.title}</p>
        <p className="text-2xs text-sentinel-muted mt-1">{inc.location}</p>
      </div>
    </div>
  );
}
