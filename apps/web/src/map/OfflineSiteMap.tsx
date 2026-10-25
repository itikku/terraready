import type { Route, Site, Status } from "../types";
import { centroid, COLORS, LABELS, toPixel } from "./geometry";

interface Props {
  site: Site;
  statuses: Record<string, Status>;
  selected: string;
  route: Route;
  onSelect: (id: string) => void;
  overlays: boolean;
  zoom: number;
}
export default function OfflineSiteMap({
  site,
  statuses,
  selected,
  route,
  onSelect,
  overlays,
  zoom,
}: Props) {
  return (
    <svg
      className="site-svg"
      viewBox="90 360 1460 900"
      preserveAspectRatio="xMidYMid slice"
      aria-label="Aerial site map with interactive work zones"
    >
      <g
        style={{
          transform: `translate(800px, 800px) scale(${zoom}) translate(-800px, -800px)`,
        }}
      >
        <image href="/imagery/site-aerial.jpg" width="1800" height="1300" />
        <rect
          width="1800"
          height="1300"
          fill="#12261f"
          opacity=".1"
          pointerEvents="none"
        />
        {overlays && (
          <>
            {site.zones.map((zone) => {
              const [cx, cy] = centroid(zone);
              const label = LABELS[zone.id] || [cx, cy];
              const color = COLORS[statuses[zone.id] || "INSPECT"];
              return (
                <g key={zone.id}>
                  <polygon
                    points={zone.polygon
                      .map((p) => toPixel(p).join(","))
                      .join(" ")}
                    fill={color}
                    fillOpacity={selected === zone.id ? 0.35 : 0.16}
                    stroke={color}
                    strokeWidth={selected === zone.id ? 5 : 2}
                    strokeDasharray={zone.id === selected ? undefined : "8 7"}
                  />
                  <path
                    d={`M${cx},${cy} L${label[0]},${label[1]}`}
                    stroke={color}
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                    opacity=".7"
                  />
                  <g
                    role="button"
                    tabIndex={0}
                    aria-label={`Inspect ${zone.name}`}
                    onClick={() => onSelect(zone.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(zone.id);
                      }
                    }}
                    className="map-zone"
                  >
                    <rect
                      x={label[0] - 115}
                      y={label[1] - 25}
                      width="230"
                      height="50"
                      rx="9"
                      fill={selected === zone.id ? "#122f27" : "#152820"}
                      stroke={selected === zone.id ? "#fff" : "#708078"}
                      strokeWidth="1.5"
                    />
                    <circle
                      cx={label[0] - 96}
                      cy={label[1]}
                      r="5"
                      fill={color}
                    />
                    <text
                      x={label[0] - 80}
                      y={label[1] + 6}
                      fill="#fff"
                      fontSize="19"
                      fontFamily="DM Sans, sans-serif"
                      fontWeight="500"
                    >
                      {zone.name}
                    </text>
                  </g>
                </g>
              );
            })}
            <polyline
              points={route.path.map((p) => toPixel(p).join(",")).join(" ")}
              fill="none"
              stroke="#13291f"
              strokeWidth="15"
              strokeLinejoin="round"
              opacity=".65"
            />
            <polyline
              points={route.path.map((p) => toPixel(p).join(",")).join(" ")}
              fill="none"
              stroke="#f4ecd2"
              strokeWidth="5"
              strokeDasharray="12 10"
              strokeLinejoin="round"
              className="route-line"
            />
            {route.path
              .filter((_, i) => i === 0 || i === route.path.length - 1)
              .map((point, i) => {
                const [x, y] = toPixel(point);
                return (
                  <g key={i} aria-hidden="true">
                    <circle
                      cx={x}
                      cy={y}
                      r="17"
                      fill="#f7f4e9"
                      stroke="#244437"
                      strokeWidth="5"
                    />
                    <circle cx={x} cy={y} r="5" fill="#244437" />
                  </g>
                );
              })}
          </>
        )}
      </g>
    </svg>
  );
}
