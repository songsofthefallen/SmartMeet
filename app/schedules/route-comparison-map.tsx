"use client";

import { useAuth } from "@clerk/nextjs";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LocationSelection, RouteAlternativeEstimate, RouteLandmarkEstimate } from "@/lib/schedule-api";
import { scheduleApi } from "@/lib/schedule-api";

const ROUTE_COLORS = ["#2563EB", "#DC2626", "#7C3AED", "#059669", "#D97706", "#DB2777"];
const IMAGE_WIDTH = 960;
const IMAGE_HEIGHT = 420;
const MERCATOR_LIMIT = 85.05112878;

function mercatorY(latitude: number): number {
  const radians = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, latitude)) * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function inverseMercatorY(value: number): number {
  return (2 * Math.atan(Math.exp(value)) - Math.PI / 2) * 180 / Math.PI;
}

export function RouteComparisonMap({ routes, selectedRouteId, origin, destination, mode = "compare" }: { routes: RouteAlternativeEstimate[]; selectedRouteId: string | null; origin: LocationSelection | null; destination: LocationSelection | null; mode?: "compare" | "view" }) {
  const { getToken } = useAuth();
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [unavailableKey, setUnavailableKey] = useState<string | null>(null);
  const [landmarkResult, setLandmarkResult] = useState<{ key: string; items: RouteLandmarkEstimate[]; failed: boolean } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const selectedRoute = routes.find((route) => route.route_id === selectedRouteId) ?? routes[0];
  const activeRouteId = selectedRoute?.route_id ?? null;
  const visibleRoutes = useMemo(() => mode === "view" && selectedRoute ? [selectedRoute] : routes, [mode, routes, selectedRoute]);
  const selectedPoints = useMemo(() => selectedRoute?.geometry ?? [], [selectedRoute]);
  const landmarkKey = selectedRoute ? `${selectedRoute.route_id}:${JSON.stringify(selectedPoints)}` : "";
  const map = useMemo(() => {
    const points = [
      ...visibleRoutes.flatMap((route) => route.geometry ?? []),
      ...(origin ? [{ latitude: origin.latitude, longitude: origin.longitude }] : []),
      ...(destination ? [{ latitude: destination.latitude, longitude: destination.longitude }] : []),
    ];
    if (points.length < 2) return null;
    let minX = Math.min(...points.map((point) => point.longitude)) * Math.PI / 180;
    let maxX = Math.max(...points.map((point) => point.longitude)) * Math.PI / 180;
    let minY = Math.min(...points.map((point) => mercatorY(point.latitude)));
    let maxY = Math.max(...points.map((point) => mercatorY(point.latitude)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    let width = Math.max(maxX - minX, 0.0001) * 1.28;
    let height = Math.max(maxY - minY, 0.0001) * 1.28;
    const aspect = IMAGE_WIDTH / IMAGE_HEIGHT;
    if (width / height < aspect) width = height * aspect;
    else height = width / aspect;
    const worldSpanX = width / (2 * Math.PI);
    const worldSpanY = height / (2 * Math.PI);
    const zoomFit = Math.min(IMAGE_WIDTH / (256 * worldSpanX), IMAGE_HEIGHT / (256 * worldSpanY));
    const zoom = Math.max(0, Math.min(20, Math.floor(Math.log2(zoomFit) + 1e-7)));
    width = IMAGE_WIDTH * 2 * Math.PI / (256 * 2 ** zoom);
    height = IMAGE_HEIGHT * 2 * Math.PI / (256 * 2 ** zoom);
    minX = centerX - width / 2;
    maxX = centerX + width / 2;
    minY = centerY - height / 2;
    maxY = centerY + height / 2;
    const bounds = {
      min_lon: Math.max(-180, minX * 180 / Math.PI),
      min_lat: Math.max(-MERCATOR_LIMIT, inverseMercatorY(minY)),
      max_lon: Math.min(180, maxX * 180 / Math.PI),
      max_lat: Math.min(MERCATOR_LIMIT, inverseMercatorY(maxY)),
    };
    return { bounds, minX, maxX, minY, maxY };
  }, [visibleRoutes, origin, destination]);

  useEffect(() => {
    if (selectedPoints.length < 2 || !landmarkKey) return;
    let active = true;
    void getToken().then((token) => scheduleApi.routeLandmarks(selectedPoints, token)).then((items) => {
      if (active) setLandmarkResult({ key: landmarkKey, items, failed: false });
    }).catch(() => {
      if (active) setLandmarkResult({ key: landmarkKey, items: [], failed: true });
    });
    return () => { active = false; };
  }, [getToken, landmarkKey, selectedPoints]);

  useEffect(() => {
    if (!map) return;
    let active = true;
    let createdUrl: string | null = null;
    const key = JSON.stringify(map.bounds);
    void getToken().then((token) => scheduleApi.routeMap(map.bounds, token)).then((blob) => {
      if (!active) return;
      createdUrl = URL.createObjectURL(blob);
      setImage({ key, url: createdUrl });
    }).catch(() => {
      if (active) setUnavailableKey(key);
    });
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [getToken, map]);

  if (!map) return null;
  const mapKey = JSON.stringify(map.bounds);
  const imageUrl = image?.key === mapKey ? image.url : null;
  const mapUnavailable = unavailableKey === mapKey;
  const toPoint = (point: { latitude: number; longitude: number }) => {
    const x = point.longitude * Math.PI / 180;
    const y = mercatorY(point.latitude);
    return `${((x - map.minX) / (map.maxX - map.minX)) * IMAGE_WIDTH},${((map.maxY - y) / (map.maxY - map.minY)) * IMAGE_HEIGHT}`;
  };
  const validRoutes = visibleRoutes.map((route) => ({ route, index: routes.indexOf(route), points: route.geometry ?? [] })).filter(({ points }) => points.length > 1);
  const drawOrder = [...validRoutes].sort(({ route: left }, { route: right }) => Number(left.route_id === activeRouteId) - Number(right.route_id === activeRouteId));
  const firstRoutePoints = selectedRoute?.geometry ?? validRoutes[0]?.points ?? [];
  const startPoint = origin ? { latitude: origin.latitude, longitude: origin.longitude } : firstRoutePoints[0];
  const endPoint = destination ? { latitude: destination.latitude, longitude: destination.longitude } : firstRoutePoints.at(-1);
  const start = startPoint ? toPoint(startPoint).split(",") : null;
  const end = endPoint ? toPoint(endPoint).split(",") : null;
  const landmarks = landmarkResult?.key === landmarkKey ? landmarkResult.items : [];
  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

  return <figure className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]" aria-label={mode === "view" ? "Map of the saved driving route" : "Map comparing driving routes"}>
    <div className="relative aspect-[16/7] w-full overflow-hidden">
      <div className="absolute inset-0 touch-none cursor-grab active:cursor-grabbing" style={{ transform, transformOrigin: "center", transition: isDragging ? "none" : "transform 120ms ease-out" }} onPointerDown={(event) => { if (zoom === 1) return; drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; setIsDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (drag.current) setPan({ x: drag.current.panX + event.clientX - drag.current.x, y: drag.current.panY + event.clientY - drag.current.y }); }} onPointerUp={() => { drag.current = null; setIsDragging(false); }} onPointerCancel={() => { drag.current = null; setIsDragging(false); }}>
      {imageUrl && <Image unoptimized fill sizes="(max-width: 768px) 100vw, 960px" src={imageUrl} alt="TomTom road map with labeled roads and nearby places" className="object-fill"/>}
      {!imageUrl && <div className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-[var(--text-secondary)]">{mapUnavailable ? "Detailed map unavailable; route comparisons remain available below." : "Loading detailed road map…"}</div>}
      {imageUrl && <svg viewBox={`0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}`} role="img" aria-label={mode === "view" ? "Saved selected driving route" : "Colored route lines show where the driving options differ"} className="absolute inset-0 h-full w-full">
        {drawOrder.map(({ route, index, points }) => {
          const selected = activeRouteId === route.route_id;
          const line = points.map(toPoint).join(" ");
          return <g key={route.route_id} opacity={selected ? 1 : 0.3}>
            <polyline points={line} fill="none" stroke="white" strokeWidth={selected ? 14 : 8} strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={line} fill="none" stroke={ROUTE_COLORS[index % ROUTE_COLORS.length]} strokeWidth={selected ? 8 : 3} strokeLinecap="round" strokeLinejoin="round"/>
          </g>;
        })}
        {start && end && <><circle cx={start[0]} cy={start[1]} r="13" fill="white" stroke="#047857" strokeWidth="3"/><text x={start[0]} y={Number(start[1]) + 4} textAnchor="middle" fontSize="11" fontWeight="bold" fill="#047857">A</text><circle cx={end[0]} cy={end[1]} r="13" fill="white" stroke="#D97706" strokeWidth="3"/><text x={end[0]} y={Number(end[1]) + 4} textAnchor="middle" fontSize="11" fontWeight="bold" fill="#92400E">B</text></>}
        {landmarks.map((landmark, index) => { const [x, y] = toPoint(landmark).split(","); const color = landmark.category === "hospital" ? "#B91C1C" : "#7C3AED"; return <g key={`${landmark.category}-${landmark.name}-${index}`}><title>{`${landmark.category === "hospital" ? "Hospital" : "School"}: ${landmark.name}`}</title><circle cx={x} cy={y} r="9" fill="white" stroke={color} strokeWidth="3"/><text x={x} y={Number(y) + 4} textAnchor="middle" fontSize="11" fontWeight="bold" fill={color}>{landmark.category === "hospital" ? "+" : "S"}</text></g>; })}
      </svg>}
      </div>
      <div className="absolute left-2 top-2 z-10 flex gap-1 rounded-lg bg-[var(--surface)]/95 p-1 shadow" aria-label="Map zoom controls"><button type="button" className="min-h-9 min-w-9 rounded-md text-lg font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50" aria-label="Zoom in map" disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.5))}>+</button><button type="button" className="min-h-9 min-w-9 rounded-md text-lg font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-hover)] disabled:opacity-50" aria-label="Zoom out map" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.5))}>−</button><button type="button" className="min-h-9 rounded-md px-2 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)]" aria-label="Reset map zoom and position" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Reset</button></div>
      <span className="absolute bottom-2 left-2 rounded-md bg-[var(--surface)]/95 px-2 py-1 text-xs font-medium text-[var(--text-primary)] shadow">A · {origin?.name ?? "Origin"}</span>
      <span className="absolute bottom-2 right-2 rounded-md bg-[var(--surface)]/95 px-2 py-1 text-xs font-medium text-[var(--text-primary)] shadow">B · {destination?.name ?? "Destination"}</span>
    </div>
    <figcaption className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-secondary)]">
      {visibleRoutes.map((route) => { const index = routes.indexOf(route); return <span key={route.route_id} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ROUTE_COLORS[index % ROUTE_COLORS.length] }}/>{mode === "view" ? "Saved selected route" : `Route ${index + 1}${activeRouteId === route.route_id ? " · Selected" : ""}`}</span>; })}
      <span className="inline-flex items-center gap-1.5"><span className="font-bold text-[var(--state-error)]">+</span>Hospital <span className="ml-2 font-bold text-[#7C3AED]">S</span>School</span>
      {landmarkResult?.key === landmarkKey && landmarkResult.failed && <span className="basis-full">Landmarks could not be loaded for this route.</span>}
      {landmarkResult?.key === landmarkKey && !landmarkResult.failed && landmarks.length === 0 && <span className="basis-full">No hospitals or schools were found near this route.</span>}
      {landmarks.length > 0 && <span className="basis-full text-[var(--text-primary)]">Near selected route: {landmarks.slice(0, 8).map((landmark) => landmark.name).join(" · ")}{landmarks.length > 8 ? ` · +${landmarks.length - 8} more` : ""}</span>}
      <span className="basis-full text-[var(--text-muted)]">Map © TomTom · Nearby labels depend on map coverage.</span>
    </figcaption>
  </figure>;
}
