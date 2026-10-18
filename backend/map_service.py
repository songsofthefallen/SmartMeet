"""TomTom static map image adapter used by the route comparison preview."""

import math
import os

import httpx
from dotenv import load_dotenv

TOMTOM_STATIC_MAP_URL = "https://api.tomtom.com/map/1/staticimage"
TOMTOM_MAP_TIMEOUT_SECONDS = 8.0
MAX_MAP_IMAGE_BYTES = 4_000_000


class MapProviderError(Exception):
    """Raised when TomTom cannot provide a map background."""

    def __init__(
        self,
        message: str,
        *,
        reason: str = "provider_error",
        provider_status: int | None = None,
        provider_error_code: str | None = None,
        provider_error_targets: tuple[str, ...] = (),
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.provider_status = provider_status
        self.provider_error_code = provider_error_code
        self.provider_error_targets = provider_error_targets


class TomTomMapService:
    def __init__(self, api_key: str | None = None) -> None:
        load_dotenv()
        self.api_key = (api_key if api_key is not None else os.getenv("TOMTOM_API_KEY", "")).strip()
        if not self.api_key:
            raise MapProviderError("Map service is not configured")

    def static_image(self, bbox: tuple[float, float, float, float]) -> tuple[bytes, str]:
        min_lon, min_lat, max_lon, max_lat = bbox
        longitude_span = (max_lon - min_lon) / 360
        min_lat_radians = min_lat * math.pi / 180
        max_lat_radians = max_lat * math.pi / 180
        mercator_span = (
            math.log(math.tan(math.pi / 4 + max_lat_radians / 2))
            - math.log(math.tan(math.pi / 4 + min_lat_radians / 2))
        ) / (2 * math.pi)
        zoom_fit = min(960 / (256 * longitude_span), 420 / (256 * mercator_span))
        zoom = max(0, min(20, int(math.log2(zoom_fit) + 1e-7)))
        center_lon = (min_lon + max_lon) / 2
        min_mercator = math.log(math.tan(math.pi / 4 + min_lat_radians / 2))
        max_mercator = math.log(math.tan(math.pi / 4 + max_lat_radians / 2))
        center_lat = (2 * math.atan(math.exp((min_mercator + max_mercator) / 2)) - math.pi / 2) * 180 / math.pi
        try:
            response = httpx.get(
                TOMTOM_STATIC_MAP_URL,
                params={
                    "key": self.api_key,
                    "center": f"{center_lon},{center_lat}",
                    "width": 960,
                    "height": 420,
                    "zoom": zoom,
                    "format": "png",
                    "layer": "basic",
                    "style": "main",
                    "view": "Unified",
                },
                timeout=TOMTOM_MAP_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            provider_status = exc.response.status_code
            reason = "credentials" if provider_status in {401, 403} else "rate_limit" if provider_status == 429 else "provider_error"
            error_code: str | None = None
            error_targets: set[str] = set()
            try:
                payload = exc.response.json()
                detailed_error = payload.get("detailedError") if isinstance(payload, dict) else None
                if isinstance(detailed_error, dict):
                    candidate_code = detailed_error.get("code")
                    if isinstance(candidate_code, str):
                        error_code = candidate_code[:80]
                    details = detailed_error.get("details")
                    if isinstance(details, list):
                        for detail in details:
                            if isinstance(detail, dict):
                                target = detail.get("target")
                                if isinstance(target, str) and target.isascii() and target.replace("_", "").isalnum():
                                    error_targets.add(target[:80])
            except ValueError:
                pass
            raise MapProviderError(
                "Map image could not be loaded", reason=reason, provider_status=provider_status,
                provider_error_code=error_code, provider_error_targets=tuple(sorted(error_targets)),
            ) from exc
        except httpx.TimeoutException as exc:
            raise MapProviderError("Map image request timed out", reason="timeout") from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise MapProviderError("Map image could not be loaded", reason="network_error") from exc

        content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if content_type != "image/png" or not response.content or len(response.content) > MAX_MAP_IMAGE_BYTES:
            raise MapProviderError("Map image response was invalid")
        return response.content, content_type
