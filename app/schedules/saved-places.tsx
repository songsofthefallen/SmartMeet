"use client";

import { useAuth } from "@clerk/nextjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { scheduleApi, ScheduleApiError, type LocationSelection, type SavedPlace, type SavedPlaceInput } from "@/lib/schedule-api";
import { savedPlacesViewState } from "@/lib/saved-places-view.js";

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

export function SavedPlacesPanel() {
  const { getToken } = useAuth();
  const { places, setPlaces, loading, error, reload } = useSavedPlaces();
  const [alias, setAlias] = useState("");
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<LocationSelection[]>([]);
  const [selected, setSelected] = useState<LocationSelection | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const generation = useRef(0);
  const saveInFlight = useRef(false);
  const listState = savedPlacesViewState(loading, error, places.length > 0 || editing !== null);
  const reset = () => { setAlias(""); setQuery(""); setCandidates([]); setSelected(null); setEditing(null); setNotice(null); setFormError(null); generation.current++; };
  const search = async () => {
    const q = query.trim();
    if (q.length < 2) { setFormError("Enter at least two characters to search."); return; }
    const current = ++generation.current; setSearching(true); setFormError(null); setCandidates([]); setSelected(null);
    try { const result = await scheduleApi.searchLocations(q, await getToken()); if (current === generation.current) setCandidates(result.results); }
    catch (cause) { if (current === generation.current) setFormError(cause instanceof Error ? cause.message : "Location search failed."); }
    finally { if (current === generation.current) setSearching(false); }
  };
  const beginEdit = (place: SavedPlace) => { reset(); setEditing(place.id); setAlias(place.alias); setSelected({ name: place.display_name, locality: place.locality, region: place.region, country: place.country, latitude: place.latitude, longitude: place.longitude, timezone: place.timezone }); };
  const save = async () => {
    if (saveInFlight.current) return;
    if (!alias.trim() || !selected) { setFormError("Enter an alias and select a confirmed search result."); return; }
    const input: SavedPlaceInput = { alias: alias.trim(), display_name: selected.name, latitude: selected.latitude, longitude: selected.longitude, locality: selected.locality, region: selected.region, country: selected.country, timezone: selected.timezone, formatted_address: [selected.locality, selected.region, selected.country].filter(Boolean).join(", ") || null, location_source: "tomtom_search" };
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

  return <section className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby="saved-places-heading">
    <h2 id="saved-places-heading" className="text-lg font-semibold">Saved places</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Save confirmed locations to reuse as schedule origins or destinations.</p>
    {listState === "loading" ? <p className="mt-4 text-sm text-[var(--text-muted)]" role="status">Loading saved places…</p> : listState === "error" ? <div className="mt-4 text-sm text-[var(--state-error)]" role="alert">{error} <button className="underline" onClick={() => void reload()}>Retry</button></div> : listState === "empty" ? <p className="mt-4 text-sm text-[var(--text-muted)]">No saved places yet.</p> : <ul className="mt-4 divide-y divide-[var(--border)]">{places.map((place) => <li key={place.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{place.alias}</p><p className="text-sm text-[var(--text-secondary)]">{place.display_name}{place.formatted_address ? ` · ${place.formatted_address}` : ""}</p></div><div className="flex gap-2"><button className={button} onClick={() => beginEdit(place)}>Edit</button><button className={button} onClick={() => void remove(place)}>Delete</button></div></li>)}</ul>}
    <div className="mt-4 border-t border-[var(--border)] pt-4"><h3 className="font-semibold">{editing ? "Edit saved place" : "Add a place"}</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-sm">Alias<input className={field} maxLength={100} value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="Home, School, Work, or your own name"/></label><div><label className="text-sm" htmlFor="saved-place-search">Search location</label><div className="mt-1 flex gap-2"><input id="saved-place-search" className={`${field} mt-0`} value={query} onChange={(event) => { setQuery(event.target.value); setCandidates([]); setSelected(null); generation.current++; }} placeholder="Search an address or place" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }}/><button className={button} disabled={searching} onClick={() => void search()}>{searching ? "Searching…" : "Search"}</button></div></div></div>
      {candidates.length > 0 && <ul className="mt-3 space-y-2" aria-label="Location candidates">{candidates.map((candidate, index) => <li key={`${candidate.latitude}:${candidate.longitude}:${index}`}><button className={`w-full rounded-lg border p-3 text-left text-sm ${selected === candidate ? "border-[var(--brand-primary)] bg-[var(--brand-subtle)]" : "border-[var(--border)] hover:bg-[var(--surface-hover)]"}`} onClick={() => setSelected(candidate)}><span className="font-medium">{candidate.name}</span><span className="block text-[var(--text-secondary)]">{[candidate.locality, candidate.region, candidate.country].filter(Boolean).join(", ")}</span></button></li>)}</ul>}
      {selected && <div className="mt-3 rounded-lg border border-[var(--state-success)] bg-[var(--state-success-bg)] p-3 text-sm"><p className="font-semibold">Confirm this location</p><p>{selected.name} · {selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</p><p className="text-xs">Select Save to confirm and store these coordinates.</p></div>}{formError && <p className="mt-3 text-sm text-[var(--state-error)]" role="alert">{formError}</p>}{notice && <p className="mt-3 text-sm text-[var(--state-success)]" role="status">{notice}</p>}
      <div className="mt-3 flex gap-2"><button className={primary} disabled={saving || !selected || !alias.trim()} onClick={() => void save()}>{saving ? "Saving…" : editing ? "Save changes" : "Save place"}</button>{editing && <button className={button} onClick={reset}>Cancel</button>}</div>
    </div>
  </section>;
}
