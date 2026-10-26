"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { scheduleApi, ScheduleApiError, type LocationSelection, type SavedPlace, type SavedPlaceInput, type SavedPlaceSource } from "@/lib/schedule-api";
import { savedPlacesViewState } from "@/lib/saved-places-view.js";
import { isValidCoordinate, requestCurrentLocation } from "@/lib/saved-place-location.js";
import { SavedPlaceMapPicker } from "./saved-place-map-picker";

type SelectedLocation = LocationSelection & { formatted_address: string | null; location_source: SavedPlaceSource };

const field = "mt-1 block w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm text-[var(--text-primary)]";
const button = "rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold hover:bg-[var(--surface-hover)] disabled:opacity-60";
const primary = "rounded-xl bg-[var(--brand-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[var(--brand-hover)] disabled:opacity-60";

export function useSavedPlaces() {
  const { getToken, isLoaded } = useAuth();
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!isLoaded) return;
    setLoading(true);
    try { setPlaces(await scheduleApi.savedPlaces(await getToken())); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load saved places."); }
    finally { setLoading(false); }
  }, [getToken, isLoaded]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);
  useEffect(() => {
    const refresh = () => { void reload(); };
    window.addEventListener("saved-places-updated", refresh);
    return () => window.removeEventListener("saved-places-updated", refresh);
  }, [reload]);
  return { places, setPlaces, loading, error, reload };
}

export function SavedPlacesManager() {
  const { getToken } = useAuth();
  const { places, setPlaces, loading, error, reload } = useSavedPlaces();
  const [alias, setAlias] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<LocationSelection[]>([]);
  const [selected, setSelected] = useState<SelectedLocation | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapInitial, setMapInitial] = useState<{ latitude: number; longitude: number } | null>(null);
  const [mapSource, setMapSource] = useState<SavedPlaceSource>("map_pin");
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [noSearchResults, setNoSearchResults] = useState(false);
  const generation = useRef(0);
  const saveInFlight = useRef(false);
  const listState = savedPlacesViewState(loading, error, places.length > 0 || editing !== null);
  const reset = () => { setAlias(""); setQuery(""); setCandidates([]); setSelected(null); setEditing(null); setNotice(null); setFormError(null); setMapOpen(false); setMapInitial(null); setGpsError(null); setNoSearchResults(false); generation.current++; };
  const search = async () => {
    const q = query.trim();
    if (q.length < 2) { setFormError("Enter at least two characters to search."); return; }
    const current = ++generation.current; setSearching(true); setFormError(null); setCandidates([]); setSelected(null); setNoSearchResults(false);
    try { const result = await scheduleApi.searchLocations(q, await getToken()); if (current === generation.current) { setCandidates(result.results); setNoSearchResults(result.results.length === 0); } }
    catch (cause) { if (current === generation.current) setFormError(cause instanceof Error ? cause.message : "Location search failed."); }
    finally { if (current === generation.current) setSearching(false); }
  };
  const beginEdit = (place: SavedPlace) => { reset(); setEditing(place.id); setAlias(place.alias); setSelected({ name: place.display_name, locality: place.locality, region: place.region, country: place.country, latitude: place.latitude, longitude: place.longitude, timezone: place.timezone, formatted_address: place.formatted_address, location_source: place.location_source }); };
  const requestCurrentLocationAction = async () => {
    setGpsError(null); setGpsLoading(true);
    try {
      const coordinate = await requestCurrentLocation(typeof navigator === "undefined" ? null : navigator.geolocation);
      setMapInitial(coordinate); setMapSource("gps"); setMapOpen(true); setSelected(null); setNoSearchResults(false);
    } catch (cause) { setGpsError(cause instanceof Error ? cause.message : "Your current location is unavailable."); }
    finally { setGpsLoading(false); }
  };
  const confirmPin = (pin: { latitude: number; longitude: number; address: string | null; source: SavedPlaceSource }) => {
    if (!isValidCoordinate(pin.latitude, pin.longitude)) { setFormError("The selected coordinates are invalid."); return; }
    setSelected({ name: pin.address || (pin.source === "gps" ? "Current location" : "Map pin"), locality: null, region: null, country: null, latitude: pin.latitude, longitude: pin.longitude, timezone: null, formatted_address: pin.address, location_source: pin.source });
    setMapOpen(false); setMapInitial(null); setGpsError(null); setFormError(null);
  };
  const save = async () => {
    if (saveInFlight.current) return;
    if (!alias.trim() || !selected) { setFormError("Enter an alias and select a confirmed search result."); return; }
    if (!isValidCoordinate(selected.latitude, selected.longitude)) { setFormError("Latitude must be between -90 and 90 and longitude between -180 and 180."); return; }
    const formattedAddress = selected.formatted_address || [selected.locality, selected.region, selected.country].filter(Boolean).join(", ") || null;
    const input: SavedPlaceInput = { alias: alias.trim(), display_name: selected.name, latitude: selected.latitude, longitude: selected.longitude, locality: selected.locality, region: selected.region, country: selected.country, timezone: selected.timezone, formatted_address: formattedAddress, location_source: selected.location_source };
    saveInFlight.current = true; setSaving(true); setFormError(null);
    try { const token = await getToken(); const saved = editing ? await scheduleApi.updateSavedPlace(editing, input, token) : await scheduleApi.createSavedPlace(input, token); setPlaces((current) => [...current.filter((place) => place.id !== saved.id), saved].sort((a, b) => a.alias.localeCompare(b.alias))); window.dispatchEvent(new Event("saved-places-updated")); reset(); setNotice(editing ? "Saved place updated." : "Saved place added."); }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : "Could not save this place."); }
    finally { saveInFlight.current = false; setSaving(false); }
  };
  const remove = async (place: SavedPlace) => {
    if (!window.confirm(`Delete “${place.alias}”? Existing schedules keep their saved location snapshots.`)) return;
    try { await scheduleApi.deleteSavedPlace(place.id, await getToken()); setPlaces((current) => current.filter((item) => item.id !== place.id)); window.dispatchEvent(new Event("saved-places-updated")); setNotice("Saved place deleted."); }
    catch (cause) { setFormError(cause instanceof ScheduleApiError ? cause.message : "Could not delete this place."); }
  };

  return <section className="border-y border-[var(--border)] py-5 sm:py-7" aria-labelledby="saved-places-manager-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="saved-places-manager-heading" className="text-xl font-semibold tracking-tight">Your places</h2><p className="mt-1 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">Keep Home, School, Work, Gym, and custom aliases ready for schedule locations.</p></div><span className="text-sm tabular-nums text-[var(--text-muted)]">{places.length} {places.length === 1 ? "place" : "places"}</span></div>
    {listState === "loading" ? <p className="mt-5 text-sm text-[var(--text-muted)]" role="status">Loading saved places…</p> : listState === "error" ? <div className="mt-4 text-sm text-[var(--state-error)]" role="alert">{error} <button className="underline" onClick={() => void reload()}>Retry</button></div> : listState === "empty" ? <div className="mt-5 border-t border-[var(--border)] py-5"><p className="font-medium">No places saved yet</p><p className="mt-1 text-sm text-[var(--text-muted)]">Add a familiar place or pin a location on the map to reuse it while planning.</p></div> : <ul className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)]">{places.map((place) => <li key={place.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{place.alias}</p><p className="text-sm text-[var(--text-secondary)]">{place.display_name}{place.formatted_address ? ` · ${place.formatted_address}` : ""}</p></div><div className="flex gap-2"><button className={button} onClick={() => beginEdit(place)}>Edit</button><button className={button} onClick={() => void remove(place)}>Delete</button></div></li>)}</ul>}
    <div className="mt-4 border-t border-[var(--border)] pt-4"><h3 className="font-semibold">{editing ? "Edit saved place" : "Add a place"}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Alias<input className={field} maxLength={100} value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="Home, School, Work, or your own name"/></label><div><label className="text-sm" htmlFor="saved-place-search">Search location</label><div className="mt-1 flex gap-2"><input id="saved-place-search" className={`${field} mt-0`} value={query} onChange={(event) => { setQuery(event.target.value); setCandidates([]); setSelected(null); setNoSearchResults(false); generation.current++; }} placeholder="Search an address or place" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}/><button type="button" className={button} disabled={searching} onClick={() => void search()}>{searching ? "Searching…" : "Search"}</button></div></div></div>
      {candidates.length > 0 && <ul className="mt-3 space-y-2" aria-label="Location candidates">{candidates.map((candidate, index) => <li key={`${candidate.latitude}:${candidate.longitude}:${index}`}><button type="button" className={`w-full rounded-lg border p-3 text-left text-sm ${selected?.latitude === candidate.latitude && selected.longitude === candidate.longitude ? "border-[var(--brand-primary)] bg-[var(--brand-subtle)]" : "border-[var(--border)] hover:bg-[var(--surface-hover)]"}`} onClick={() => setSelected({ ...candidate, formatted_address: [candidate.locality, candidate.region, candidate.country].filter(Boolean).join(", ") || null, location_source: "tomtom_search" })}><span className="font-medium">{candidate.name}</span><span className="block text-[var(--text-secondary)]">{[candidate.locality, candidate.region, candidate.country].filter(Boolean).join(", ")}</span></button></li>)}</ul>}
      {noSearchResults && <p className="mt-3 text-sm text-[var(--text-muted)]" role="status">No suitable search result was found. Choose a point on the map instead.</p>}
      <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} onClick={() => { setMapInitial(selected ? { latitude: selected.latitude, longitude: selected.longitude } : null); setMapSource("map_pin"); setMapOpen(true); setGpsError(null); }}>Choose on map</button><button type="button" className={button} disabled={gpsLoading} onClick={() => void requestCurrentLocationAction()}>{gpsLoading ? "Getting location…" : "Use my current location"}</button></div>
      {gpsLoading && <p className="mt-2 text-sm text-[var(--text-muted)]" role="status">Waiting for browser location permission and coordinates…</p>}{gpsError && <p className="mt-2 text-sm text-[var(--state-warning)]" role="status">{gpsError}</p>}
      {mapOpen && <SavedPlaceMapPicker key={`${mapInitial?.latitude ?? "world"}:${mapInitial?.longitude ?? "world"}`} initial={mapInitial} source={mapSource} onConfirm={confirmPin} onCancel={() => { setMapOpen(false); setMapInitial(null); }} />}
      {selected && <div className="mt-3 rounded-lg border border-[var(--state-success)] bg-[var(--state-success-bg)] p-3 text-sm"><p className="font-semibold">Confirm this location</p><p>{selected.name}{selected.formatted_address ? ` · ${selected.formatted_address}` : ""}</p><p className="font-mono tabular-nums">{selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}</p><p className="text-xs">Select Save to confirm and store these coordinates.</p></div>}{formError && <p className="mt-3 text-sm text-[var(--state-error)]" role="alert">{formError}</p>}{notice && <p className="mt-3 text-sm text-[var(--state-success)]" role="status">{notice}</p>}
      <div className="mt-3 flex gap-2"><button type="button" className={primary} disabled={saving || !selected || !alias.trim()} onClick={() => void save()}>{saving ? "Saving…" : editing ? "Save changes" : "Save place"}</button>{editing && <button type="button" className={button} onClick={reset}>Cancel</button>}</div>
    </div>
  </section>;
}
