"""Deterministic, provider-evidence-based route recommendations."""

from __future__ import annotations

from schemas import RouteAlternative, RouteAlternativeExplanation, RouteRecommendation, classify_traffic_estimate_type


def _traffic_available(route: RouteAlternative, route_time_basis: str) -> bool:
    return classify_traffic_estimate_type(
        route_time_basis=route_time_basis,
        traffic_delay_seconds=route.traffic_delay_seconds,
        historic_traffic_travel_time_seconds=route.historic_traffic_travel_time_seconds,
        live_traffic_incidents_travel_time_seconds=route.live_traffic_incidents_travel_time_seconds,
    ) != "unavailable"


def _delta(seconds: int) -> str:
    minutes, remainder = divmod(seconds, 60)
    if minutes and remainder:
        return f"approximately {minutes} min {remainder} sec"
    if minutes:
        return f"approximately {minutes} min"
    return f"{remainder} sec"


def _distance(meters: int) -> str:
    return f"{meters / 1000:.1f} km"


def build_route_recommendation(routes: list[RouteAlternative], *, route_time_basis: str = "current") -> RouteRecommendation:
    """Recommend the shortest valid traffic-adjusted route; preserve input order for ties."""
    valid = [
        route for route in routes
        if isinstance(route.duration_seconds, int)
        and not isinstance(route.duration_seconds, bool)
        and route.duration_seconds > 0
        and (route.distance_meters is None or route.distance_meters > 0)
    ]
    if not valid:
        return RouteRecommendation(
            recommended_route_id=None,
            reason_codes=["no_valid_routes"],
            explanation="No valid route is available to recommend.",
            traffic_information_available=False,
        )

    recommended = min(valid, key=lambda route: route.duration_seconds)
    alternatives = [route for route in valid if route.route_id != recommended.route_id]
    if alternatives:
        next_duration = min(route.duration_seconds for route in alternatives)
        delta = next_duration - recommended.duration_seconds
        explanation = "Recommended because this route has the shortest estimated travel time."
        if delta > 0:
            explanation += f" It is {_delta(delta)} faster than the next available alternative."
        codes = ["shortest_estimated_duration"]
    else:
        explanation = "Recommended because it is the only valid route available."
        codes = ["only_valid_route"]

    comparisons: list[RouteAlternativeExplanation] = []
    for route in valid:
        if route.route_id == recommended.route_id:
            continue
        duration_delta = route.duration_seconds - recommended.duration_seconds
        distance_delta = (
            route.distance_meters - recommended.distance_meters
            if route.distance_meters is not None and recommended.distance_meters is not None
            else None
        )
        if duration_delta > 0 and distance_delta is not None and distance_delta < 0:
            text = f"This route is {_distance(abs(distance_delta))} shorter in distance, but takes {_delta(duration_delta)} longer. It may suit a shorter-distance preference."
            reason = "shorter_but_slower"
        elif duration_delta > 0 and distance_delta is not None and distance_delta > 0:
            text = f"This route takes {_delta(duration_delta)} longer and is {_distance(distance_delta)} longer in distance than the recommended route."
            reason = "slower_and_longer"
        elif duration_delta > 0:
            text = f"This route takes {_delta(duration_delta)} longer than the recommended route."
            reason = "slower"
        elif distance_delta is not None and distance_delta < 0:
            text = "This route has the same estimated travel time and covers less distance."
            reason = "equal_time_shorter_distance"
        elif distance_delta is not None and distance_delta > 0:
            text = "This route has the same estimated travel time and covers more distance."
            reason = "equal_time_longer_distance"
        else:
            text = "This route has the same estimated travel time; provider order breaks the tie deterministically."
            reason = "equal_duration_tie"
        comparisons.append(RouteAlternativeExplanation(
            route_id=route.route_id,
            reason_codes=[reason],
            explanation=text,
            traffic_information_available=_traffic_available(route, route_time_basis),
        ))

    return RouteRecommendation(
        recommended_route_id=recommended.route_id,
        reason_codes=codes,
        explanation=explanation,
        traffic_information_available=_traffic_available(recommended, route_time_basis),
        alternatives=comparisons,
    )
