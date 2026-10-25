import { useEffect, useMemo, useRef } from "react";
import mapboxgl, { type GeoJSONSource } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { FeatureCollection, Polygon } from "geojson";
import type { Route, Site, Status } from "../types";
import { COLORS, toLngLat } from "./geometry";

interface Props {
  site: Site;
  statuses: Record<string, Status>;
  route: Route;
  onSelect: (id: string) => void;
  onFailure: () => void;
  onReady: () => void;
  overlays: boolean;
}
export default function MapboxSiteMap({
  site,
  statuses,
  route,
  onSelect,
  onFailure,
  onReady,
  overlays,
}: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const callbacks = useRef({ onFailure, onReady, onSelect });
  useEffect(() => {
    callbacks.current = { onFailure, onReady, onSelect };
  }, [onFailure, onReady, onSelect]);
  const data: FeatureCollection<Polygon> = useMemo(
    () => ({
      type: "FeatureCollection",
      features: site.zones.map((zone) => ({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[...zone.polygon, zone.polygon[0]].map(toLngLat)],
        },
        properties: {
          id: zone.id,
          color: COLORS[statuses[zone.id] || "INSPECT"],
        },
      })),
    }),
    [site.zones, statuses],
  );
  const latest = useRef({ data, route, overlays });
  useEffect(() => {
    latest.current = { data, route, overlays };
    const m = map.current;
    if (m?.getSource("zones")) {
      (m.getSource("zones") as GeoJSONSource).setData(data);
      (m.getSource("route") as GeoJSONSource).setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: route.path.map(toLngLat) },
      });
      for (const id of ["zones-fill", "zones-outline", "route-line"])
        m.setLayoutProperty(id, "visibility", overlays ? "visible" : "none");
    }
  }, [data, route, overlays]);
  useEffect(() => {
    if (!element.current) return;
    let m: mapboxgl.Map;
    const timeout = window.setTimeout(
      () => callbacks.current.onFailure(),
      10000,
    );
    try {
      m = new mapboxgl.Map({
        container: element.current,
        accessToken: import.meta.env.VITE_MAPBOX_TOKEN,
        style: "mapbox://styles/mapbox/satellite-v9",
        center: [-122.113, 37.32],
        zoom: 15.8,
        attributionControl: true,
      });
      map.current = m;
      m.addControl(
        new mapboxgl.NavigationControl({ showCompass: false }),
        "bottom-right",
      );
      m.on("error", () => {
        window.clearTimeout(timeout);
        callbacks.current.onFailure();
      });
      m.on("load", () => {
        window.clearTimeout(timeout);
        m.addSource("zones", { type: "geojson", data: latest.current.data });
        m.addLayer({
          id: "zones-fill",
          type: "fill",
          source: "zones",
          paint: { "fill-color": ["get", "color"], "fill-opacity": 0.28 },
        });
        m.addLayer({
          id: "zones-outline",
          type: "line",
          source: "zones",
          paint: { "line-color": ["get", "color"], "line-width": 2 },
        });
        m.addSource("route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: latest.current.route.path.map(toLngLat),
            },
          },
        });
        m.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          paint: {
            "line-color": "#fff5ce",
            "line-width": 4,
            "line-dasharray": [2, 2],
          },
        });
        for (const id of ["zones-fill", "zones-outline", "route-line"])
          m.setLayoutProperty(
            id,
            "visibility",
            latest.current.overlays ? "visible" : "none",
          );
        m.fitBounds(
          [toLngLat({ x_m: 120, y_m: 10 }), toLngLat({ x_m: 1500, y_m: 1000 })],
          { padding: 40, duration: 0 },
        );
        callbacks.current.onReady();
      });
      m.on("click", "zones-fill", (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") callbacks.current.onSelect(id);
      });
    } catch {
      window.clearTimeout(timeout);
      callbacks.current.onFailure();
    }
    return () => {
      window.clearTimeout(timeout);
      map.current?.remove();
      map.current = null;
    };
  }, []);
  return (
    <div
      ref={element}
      className="mapbox-host"
      aria-label="Connected satellite map"
    />
  );
}
