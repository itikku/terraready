import type { Point, Zone } from "../types";

export const AERIAL = {
  width: 1800,
  height: 1300,
  extent: [
    -13594802.409609361, 4483105.1498714834, -13592088.909887083,
    4485064.8996709064,
  ],
};
export const toPixel = (point: Point): [number, number] => [
  point.x_m / 1.18,
  1300 - point.y_m / 1.18,
];
export function toLngLat(point: Point): [number, number] {
  const [x, y] = toPixel(point);
  const [west, south, east, north] = AERIAL.extent;
  const mercX = west + (x / AERIAL.width) * (east - west);
  const mercY = north - (y / AERIAL.height) * (north - south);
  return [
    (mercX * 180) / (Math.PI * 6378137),
    ((2 * Math.atan(Math.exp(mercY / 6378137)) - Math.PI / 2) * 180) / Math.PI,
  ];
}
export const centroid = (zone: Zone): [number, number] => {
  const points = zone.polygon.map(toPixel);
  return [
    points.reduce((s, p) => s + p[0], 0) / points.length,
    points.reduce((s, p) => s + p[1], 0) / points.length,
  ];
};
export const LABELS: Record<string, [number, number]> = {
  "service-yard": [320, 1150],
  "north-access": [695, 550],
  "south-access": [740, 1160],
  "east-cut": [1110, 680],
  "west-stockpile": [340, 850],
};
export const COLORS = { GO: "#61c9a0", INSPECT: "#f1c675", NO_GO: "#f39783" };
