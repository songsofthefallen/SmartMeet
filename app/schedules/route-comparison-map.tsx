"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TomTomMap } from "@tomtom-org/maps-sdk/map";
import type { LocationSelection, RouteAlternativeEstimate } from "@/lib/schedule-api";
import { endpointFeatureCollection, isValidMapCoordinate, routeFeatureCollection, ROUTE_COLORS, selectedRouteOrFirst } from "@/lib/route-map-geometry.js";
import { createSmartMeetMap } from "@/lib/tomtom-map";

const browserMapApiKey = process.env.NEXT_PUBLIC_TOMTOM_MAPS_API_KEY?.trim();
const routeSourceId = "smartmeet-routes";
const control = "min-h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--text-primary)] shadow hover:bg-[var(--surface-hover)] disabled:opacity-50";

type Coordinate = { latitude: number; longitude: number };
type MapLike = NonNullable<TomTomMap["mapLibreMap"]>;

const validCoordinate = isValidMapCoordinate;

function fitCoordinates(route: RouteAlternativeEstimate | undefined, origin: LocationSelection | null, destination: LocationSelection | null) {
  const geometry = (route?.geometry ?? []).filter(validCoordinate);
  return geometry.length ? geometry : [origin, destination].filter((point): point is LocationSelection => Boolean(point && validCoordinate(point)));
}

function setRouteLayers(map: MapLike, routes: RouteAlternativeEstimate[], selectedRouteId: string | null) {
  const data = routeFeatureCollection(routes, selectedRouteId);
  const source = map.getSource(routeSourceId) as { setData: (value: typeof data) => void } | undefined;
  if (source) source.setData(data);
  else {
    map.addSource(routeSourceId, { type: "geojson", data: data as never });
    map.addLayer({ id: "smartmeet-route-casing", type: "line", source: routeSourceId, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#FFFFFF", "line-width": ["case", ["get", "selected"], 10, 6], "line-opacity": ["case", ["get", "selected"], 0.95, 0.4] } });
    map.addLayer({ id: "smartmeet-route-lines", type: "line", source: routeSourceId, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "selected"], 6, 3], "line-opacity": ["case", ["get", "selected"], 1, 0.65] } });
  }
}

function setEndpointLayers(map: MapLike, origin: LocationSelection | null, destination: LocationSelection | null, fallback: Coordinate[]) {
  const data = endpointFeatureCollection(origin, destination, fallback);
  const source = map.getSource("smartmeet-endpoints") as { setData: (value: typeof data) => void } | undefined;
  if (source) source.setData(data);
  else {
    map.addSource("smartmeet-endpoints", { type: "geojson", data: data as never });
    map.addLayer({ id: "smartmeet-endpoint-circles", type: "circle", source: "smartmeet-endpoints", paint: { "circle-radius": 12, "circle-color": ["get", "color"], "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 3 } });
    map.addLayer({ id: "smartmeet-endpoint-labels", type: "symbol", source: "smartmeet-endpoints", layout: { "text-field": ["get", "label"], "text-size": 12, "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"] }, paint: { "text-color": "#FFFFFF" } });
  }
}

export function RouteComparisonMap({ routes, selectedRouteId, origin, destination, mode = "compare" }: { routes: RouteAlternativeEstimate[]; selectedRouteId: string | null; origin: LocationSelection | null; destination: LocationSelection | null; mode?: "compare" | "view" }) {
  const [mapError, setMapError] = useState<string | null>(browserMapApiKey ? null : "Interactive map unavailable: browser map key is missing.");
  const [mapLoading, setMapLoading] = useState(Boolean(browserMapApiKey));
  const [mapAttempt, setMapAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<TomTomMap | null>(null);
  const readyRef = useRef(false);
  const selectedRoute = selectedRouteOrFirst(routes, selectedRouteId);
  const activeRouteId = selectedRoute?.route_id ?? null;
  const visibleRoutes = useMemo(() => mode === "view" && selectedRoute ? [selectedRoute] : routes, [mode, routes, selectedRoute]);
  const fitPoints = useMemo(() => fitCoordinates(selectedRoute, origin, destination), [selectedRoute, origin, destination]);
  const mapCenter = useMemo(() => {
    if (fitPoints.length) {
      return fitPoints.reduce((center, point) => ({ latitude: center.latitude + point.latitude / fitPoints.length, longitude: center.longitude + point.longitude / fitPoints.length }), { latitude: 0, longitude: 0 });
    }
    return { latitude: 14.5995, longitude: 120.9842 };
  }, [fitPoints]);
  const currentMapData = useRef({ visibleRoutes, activeRouteId, origin, destination, fitPoints, fitRoute: () => undefined as void });

  const fitRoute = useCallback(() => {
    const map = mapRef.current?.mapLibreMap;
    if (!map || !fitPoints.length) return;
    if (fitPoints.length === 1) {
      map.easeTo({ center: [fitPoints[0].longitude, fitPoints[0].latitude], zoom: 14, duration: 350 });
      return;
    }
    const longitudes = fitPoints.map((point) => point.longitude);
    const latitudes = fitPoints.map((point) => point.latitude);
    map.fitBounds([[Math.min(...longitudes), Math.min(...latitudes)], [Math.max(...longitudes), Math.max(...latitudes)]], { padding: { top: 54, right: 48, bottom: 54, left: 48 }, maxZoom: 16, duration: 350 });
  }, [fitPoints]);
  useEffect(() => { currentMapData.current = { visibleRoutes, activeRouteId, origin, destination, fitPoints, fitRoute }; }, [visibleRoutes, activeRouteId, origin, destination, fitPoints, fitRoute]);

  useEffect(() => {
    if (!browserMapApiKey || !containerRef.current) return;
    let disposed = false;
    let map: TomTomMap | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let loadedHandler: (() => void) | null = null;
    let errorHandler: (() => void) | null = null;
    void (async () => {
      try {
        if (disposed || !containerRef.current) return;
        map = await createSmartMeetMap(containerRef.current, browserMapApiKey, [mapCenter.longitude, mapCenter.latitude], 12, true);
        if (disposed) { map.mapLibreMap.remove(); return; }
        mapRef.current = map;
        loadedHandler = () => {
          if (disposed) return;
          readyRef.current = true;
          setMapLoading(false);
          setMapError(null);
          const nativeMap = map!.mapLibreMap;
          const current = currentMapData.current;
          setRouteLayers(nativeMap, current.visibleRoutes, current.activeRouteId);
          setEndpointLayers(nativeMap, current.origin, current.destination, current.fitPoints);
          if (current.fitPoints.length > 1) current.fitRoute();
          resizeObserver = new ResizeObserver(() => nativeMap.resize());
          if (containerRef.current) resizeObserver.observe(containerRef.current);
        };
        errorHandler = () => { if (!disposed && !readyRef.current) { setMapLoading(false); setMapError("TomTom map could not be loaded. Route details remain available."); } };
        map.mapLibreMap.on("load", loadedHandler);
        map.mapLibreMap.on("error", errorHandler);
      } catch {
        if (!disposed) { setMapLoading(false); setMapError("Interactive map could not be initialized. Route details remain available."); }
      }
    })();
    return () => {
      disposed = true;
      readyRef.current = false;
      resizeObserver?.disconnect();
      if (map && loadedHandler) map.mapLibreMap.off("load", loadedHandler);
      if (map && errorHandler) map.mapLibreMap.off("error", errorHandler);
      map?.mapLibreMap.remove();
      mapRef.current = null;
    };
  // Map initialization belongs to this mount/retry. Route and marker changes are applied by the update effect below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapAttempt]);

  useEffect(() => {
    const map = mapRef.current?.mapLibreMap;
    if (!map || !readyRef.current) return;
    setRouteLayers(map, visibleRoutes, activeRouteId);
    setEndpointLayers(map, origin, destination, fitPoints);
  }, [visibleRoutes, activeRouteId, origin, destination, fitPoints, mapCenter]);

  useEffect(() => {
    if (readyRef.current) fitRoute();
  }, [activeRouteId, fitRoute]);

  if (!routes.length && !origin && !destination) return null;

  return <figure className="mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]" aria-label={mode === "view" ? "Map of the saved driving route" : "Map comparing driving routes"}>
    <div className="relative h-[min(62vh,30rem)] min-h-72 w-full sm:min-h-80">
      <div ref={containerRef} className="absolute inset-0" role="application" aria-label="Interactive route map. Drag to pan; use the mouse wheel or controls to zoom." />
      {mapLoading && <div className="absolute inset-0 z-10 grid place-items-center bg-[var(--surface)]/80 text-sm" role="status">Loading interactive map…</div>}
      {mapError && !mapLoading && <div className="absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2 rounded-md bg-[var(--state-error-bg)] p-2 text-xs text-[var(--state-error)]" role="alert"><span>{mapError}</span>{browserMapApiKey && <button type="button" className="font-semibold underline" onClick={() => { setMapLoading(true); setMapError(null); setMapAttempt((value) => value + 1); }}>Retry map</button>}</div>}
      <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-1 rounded-lg bg-[var(--surface)]/95 p-1 shadow" aria-label="Map controls"><button type="button" className={control} aria-label="Zoom in map" onClick={() => { const map = mapRef.current?.mapLibreMap; if (map) map.zoomIn({ duration: 150 }); }}>+</button><button type="button" className={control} aria-label="Zoom out map" onClick={() => { const map = mapRef.current?.mapLibreMap; if (map) map.zoomOut({ duration: 150 }); }}>−</button><button type="button" className={control} onClick={fitRoute}>Fit route</button></div>
      <div className="absolute bottom-2 left-2 z-10 flex gap-2 rounded-md bg-[var(--surface)]/95 px-2 py-1 text-xs font-medium text-[var(--text-primary)] shadow"><span>A · {origin?.name ?? "Origin"}</span><span aria-hidden="true">→</span><span>B · {destination?.name ?? "Destination"}</span></div>
    </div>
    <figcaption className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--text-secondary)]">
      {visibleRoutes.map((route) => { const index = routes.indexOf(route); return <span key={route.route_id} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ROUTE_COLORS[index % ROUTE_COLORS.length] }}/>{mode === "view" ? "Saved selected route" : `Route ${index + 1}${activeRouteId === route.route_id ? " · Selected" : ""}`}</span>; })}
    </figcaption>
  </figure>;
}
