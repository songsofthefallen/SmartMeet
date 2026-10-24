"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TomTomMap } from "@tomtom-org/maps-sdk/map";
import { scheduleApi, type SavedPlaceSource } from "@/lib/schedule-api";
import { centerFromMap, initialMapView, isValidCoordinate, mapFailureMessage, subscribeToMapCenter, zoomAroundCenter } from "@/lib/saved-place-map-interaction.js";

type Coordinate = { latitude: number; longitude: number };
type ConfirmedPin = Coordinate & { address: string | null; source: SavedPlaceSource };
const browserMapApiKey = process.env.NEXT_PUBLIC_TOMTOM_MAPS_API_KEY?.trim();
const control = "grid h-9 w-9 place-items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-lg font-semibold hover:bg-[var(--surface-hover)] disabled:opacity-50";

export function SavedPlaceMapPicker({ initial, source, onConfirm, onCancel }: {
  initial: Coordinate | null;
  source: SavedPlaceSource;
  onConfirm: (pin: ConfirmedPin) => void;
  onCancel: () => void;
}) {
  const { getToken } = useAuth();
  const [center, setCenter] = useState<Coordinate>(initial ?? { latitude: 0, longitude: 0 });
  const [address, setAddress] = useState<string | null>(null);
  const [geocodeState, setGeocodeState] = useState<"idle" | "loading" | "success" | "unavailable">("idle");
  const [mapError, setMapError] = useState<string | null>(browserMapApiKey ? null : mapFailureMessage("missing-key"));
  const [mapAttempt, setMapAttempt] = useState(0);
  const [mapLoading, setMapLoading] = useState(Boolean(browserMapApiKey));
  const [confirming, setConfirming] = useState(false);
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<TomTomMap | null>(null);
  const centerRef = useRef(center);
  const addressRef = useRef<string | null>(null);
  const geocodeGeneration = useRef(0);
  const confirmInFlight = useRef(false);

  const updateCenter = useCallback((coordinate: Coordinate) => {
    if (!isValidCoordinate(coordinate.latitude, coordinate.longitude)) return;
    if (coordinate.latitude !== centerRef.current.latitude || coordinate.longitude !== centerRef.current.longitude) {
      geocodeGeneration.current++;
      addressRef.current = null;
      setAddress(null);
      setGeocodeState("idle");
    }
    centerRef.current = coordinate;
    setCenter(coordinate);
  }, []);

  const reverseGeocode = useCallback(async (coordinate: Coordinate) => {
    const current = ++geocodeGeneration.current;
    addressRef.current = null;
    setAddress(null);
    setGeocodeState("loading");
    try {
      const response = await scheduleApi.reverseGeocode(coordinate, await getToken());
      if (current !== geocodeGeneration.current) return null;
      addressRef.current = response.address || null;
      setAddress(response.address || null);
      setGeocodeState(response.address ? "success" : "unavailable");
      return response.address || null;
    } catch {
      if (current !== geocodeGeneration.current) return null;
      setGeocodeState("unavailable");
      return null;
    }
  }, [getToken]);

  useEffect(() => {
    const apiKey = browserMapApiKey;
    if (!apiKey) return;
    if (!mapContainer.current) return;
    let disposed = false;
    let map: TomTomMap | null = null;
    let settleTimer: number | undefined;
    let wheelTarget: HTMLElement | null = null;
    let unsubscribeCenter: (() => void) | undefined;
    const generation = geocodeGeneration;
    const onMoveEnd = () => {
      if (!map) return;
      updateCenter(centerFromMap(map.mapLibreMap.getCenter()));
      const settledCenter = centerRef.current;
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => { void reverseGeocode(settledCenter); }, 500);
    };
    const onWheel = (event: WheelEvent) => {
      if (!map) return;
      event.preventDefault();
      zoomAroundCenter(map.mapLibreMap, event.deltaY);
    };
    void (async () => {
      try {
        const [{ TomTomMap }, { setWorkerUrl }] = await Promise.all([
          import("@tomtom-org/maps-sdk/map"),
          import("maplibre-gl"),
        ]);
        if (disposed || !mapContainer.current) return;
        setWorkerUrl("/maplibre-gl-worker.mjs");
        map = new TomTomMap({
          apiKey,
          style: "streetDark",
          mapLibre: {
            container: mapContainer.current,
            ...initialMapView(initial),
            minZoom: 0,
            maxZoom: 20,
            dragPan: true,
            scrollZoom: false,
            pitchWithRotate: false,
            dragRotate: false,
          },
        });
        mapRef.current = map;
        unsubscribeCenter = subscribeToMapCenter(map.mapLibreMap, updateCenter, () => {
          if (settleTimer !== undefined) window.clearTimeout(settleTimer);
        });
        map.mapLibreMap.on("load", () => {
          if (disposed) return;
          setMapLoading(false);
          setMapError(null);
          wheelTarget = map?.mapLibreMap.getCanvasContainer() ?? null;
          wheelTarget?.addEventListener("wheel", onWheel, { passive: false });
          if (initial && isValidCoordinate(initial.latitude, initial.longitude)) void reverseGeocode(initial);
        });
        map.mapLibreMap.on("moveend", onMoveEnd);
        map.mapLibreMap.on("error", () => {
          if (!disposed) { setMapLoading(false); setMapError(mapFailureMessage("provider")); }
        });
      } catch {
        if (!disposed) { setMapLoading(false); setMapError(mapFailureMessage("webgl")); }
      }
    })();
    return () => {
      disposed = true;
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      wheelTarget?.removeEventListener("wheel", onWheel);
      unsubscribeCenter?.();
      map?.mapLibreMap.off("moveend", onMoveEnd);
      map?.mapLibreMap.remove();
      mapRef.current = null;
      generation.current++;
    };
  }, [initial, mapAttempt, reverseGeocode, updateCenter]);

  const setZoom = (delta: number) => {
    const map = mapRef.current?.mapLibreMap;
    if (!map) return;
    map.easeTo({ center: map.getCenter(), zoom: Math.max(0, Math.min(20, map.getZoom() + delta)), duration: 150 });
  };

  const confirm = async () => {
    if (confirmInFlight.current) return;
    const coordinate = mapRef.current ? centerFromMap(mapRef.current.mapLibreMap.getCenter()) : centerRef.current;
    if (!isValidCoordinate(coordinate.latitude, coordinate.longitude)) return;
    confirmInFlight.current = true;
    setConfirming(true);
    const confirmedAddress = addressRef.current ?? await reverseGeocode(coordinate);
    onConfirm({ ...coordinate, address: confirmedAddress, source });
    confirmInFlight.current = false;
    setConfirming(false);
  };

  return <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-3" aria-label="Choose a location on the map">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">Choose a point on the map</p><div className="flex items-center gap-1" aria-label="Map controls">
      <button type="button" className={control} aria-label="Zoom out" onClick={() => setZoom(-1)}>−</button><button type="button" className={control} aria-label="Zoom in" onClick={() => setZoom(1)}>+</button>
    </div></div>
    <div className="relative aspect-[960/420] w-full overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <div ref={mapContainer} className="absolute inset-0" role="application" aria-label="Interactive map. Drag to pan; use the mouse wheel to zoom." />
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full" aria-hidden="true">
        <div className="relative h-7 w-7 rounded-full border-[3px] border-white bg-[var(--brand-primary)] shadow-lg"><span className="absolute -bottom-2 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-white bg-[var(--brand-primary)]" /></div>
      </div>
      {mapLoading && <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-[var(--surface)]/80 text-sm" role="status">Loading interactive map…</div>}
      {mapError && !mapLoading && <div className="absolute inset-x-2 top-2 z-20 flex items-start justify-between gap-2 rounded-md bg-[var(--state-error-bg)] p-2 text-xs text-[var(--state-error)]" role="alert"><span>{mapError}</span>{browserMapApiKey && <button type="button" className="shrink-0 font-semibold underline" onClick={() => { setMapLoading(true); setMapError(null); setMapAttempt((value) => value + 1); }}>Retry map</button>}</div>}
    </div>
    <p className="mt-1 text-xs text-[var(--text-muted)]">Drag the map to move the center marker. Use the mouse wheel or zoom controls to change scale. Map © TomTom.</p>
    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"><p className="font-semibold">Selected coordinates</p><p className="font-mono tabular-nums">{center.latitude.toFixed(6)}, {center.longitude.toFixed(6)}</p>{geocodeState === "loading" && <p className="text-[var(--text-muted)]" role="status">Looking up a suggested address…</p>}{geocodeState === "success" && address && <p className="mt-1">Suggested address: {address}</p>}{geocodeState === "unavailable" && <p className="mt-1 text-[var(--text-muted)]" role="status">No suggested address is available. You can still confirm and save these coordinates.</p>}</div>
    <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="rounded-xl bg-[var(--brand-primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-hover)] disabled:opacity-50" disabled={mapLoading || Boolean(mapError) || confirming || !isValidCoordinate(center.latitude, center.longitude)} onClick={() => void confirm()}>{confirming ? "Confirming…" : "Confirm location"}</button><button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-semibold" onClick={onCancel}>Cancel map selection</button></div>
  </section>;
}
