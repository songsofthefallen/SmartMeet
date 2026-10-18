"use client";

import { useAuth } from "@clerk/nextjs";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { RouteAlternativeEstimate } from "@/lib/schedule-api";
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

export function RouteComparisonMap({ routes, selectedRouteId }: { routes: RouteAlternativeEstimate[]; selectedRouteId: string | null }) {
  const { getToken } = useAuth();
  const [image, setImage] = useState<{ key: string; url: string } | null>(null);
  const [unavailableKey, setUnavailableKey] = useState<string | null>(null);
  const map = useMemo(() => {
    const points = routes.flatMap((route) => route.geometry ?? []);
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
  }, [routes]);

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
  const validRoutes = routes.map((route, index) => ({ route, index, points: route.geometry ?? [] })).filter(({ points }) => points.length > 1);
  const start = validRoutes[0] ? toPoint(validRoutes[0].points[0]).split(",") : null;
  const end = validRoutes[0] ? toPoint(validRoutes[0].points.at(-1)!).split(",") : null;

  return <figure className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]" aria-label="Map comparing driving routes">
    <div className="relative aspect-[16/7] w-full overflow-hidden">
      {imageUrl && <Image unoptimized fill sizes="(max-width: 768px) 100vw, 960px" src={imageUrl} alt="TomTom road map with labeled roads and nearby places" className="object-fill"/>}
      {!imageUrl && <div className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-[var(--text-secondary)]">{mapUnavailable ? "Detailed map unavailable; route comparisons remain available below." : "Loading detailed road map…"}</div>}
      {imageUrl && <svg viewBox={`0 0 ${IMAGE_WIDTH} ${IMAGE_HEIGHT}`} role="img" aria-label="Colored route lines show where the driving options differ" className="absolute inset-0 h-full w-full">
        {validRoutes.map(({ route, index, points }) => {
          const selected = selectedRouteId === route.route_id;
          const line = points.map(toPoint).join(" ");
          return <g key={route.route_id} opacity={selected || !selectedRouteId ? 1 : 0.62}>
            <polyline points={line} fill="none" stroke="white" strokeWidth={selected ? 12 : 9} strokeLinecap="round" strokeLinejoin="round"/>
            <polyline points={line} fill="none" stroke={ROUTE_COLORS[index % ROUTE_COLORS.length]} strokeWidth={selected ? 7 : 4} strokeLinecap="round" strokeLinejoin="round"/>
          </g>;
        })}
        {start && end && <><circle cx={start[0]} cy={start[1]} r="11" fill="white"/><circle cx={start[0]} cy={start[1]} r="7" fill="#047857"/><circle cx={end[0]} cy={end[1]} r="11" fill="white"/><circle cx={end[0]} cy={end[1]} r="7" fill="#D97706"/></>}
      </svg>}
      <span className="absolute bottom-2 left-2 rounded-md bg-[var(--surface)]/95 px-2 py-1 text-xs font-medium text-[var(--text-primary)] shadow">A · Start</span>
      <span className="absolute bottom-2 right-2 rounded-md bg-[var(--surface)]/95 px-2 py-1 text-xs font-medium text-[var(--text-primary)] shadow">B · Destination</span>
    </div>
    <figcaption className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-secondary)]">
      {routes.map((route, index) => <span key={route.route_id} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ROUTE_COLORS[index % ROUTE_COLORS.length] }}/>Route {index + 1}{selectedRouteId === route.route_id ? " · Selected" : ""}</span>)}
      <span className="basis-full text-[var(--text-muted)]">Map © TomTom · Nearby labels depend on map coverage.</span>
    </figcaption>
  </figure>;
}
