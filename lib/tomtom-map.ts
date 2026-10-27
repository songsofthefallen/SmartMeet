import type { TomTomMap } from "@tomtom-org/maps-sdk/map";

export function smartMeetMapOptions(container: HTMLElement, apiKey: string, center: [number, number], zoom: number, scrollZoom: boolean) {
  return {
    apiKey,
    style: "streetDark" as const,
    mapLibre: {
      container,
      center,
      zoom,
      minZoom: 0,
      maxZoom: 20,
      dragPan: true,
      scrollZoom,
      pitchWithRotate: false,
      dragRotate: false,
    },
  };
}

export async function createSmartMeetMap(container: HTMLElement, apiKey: string, center: [number, number], zoom: number, scrollZoom: boolean): Promise<TomTomMap> {
  const [{ TomTomMap }, { setWorkerUrl }] = await Promise.all([
    import("@tomtom-org/maps-sdk/map"),
    import("maplibre-gl"),
  ]);
  setWorkerUrl("/maplibre-gl-worker.mjs");
  return new TomTomMap(smartMeetMapOptions(container, apiKey, center, zoom, scrollZoom));
}
