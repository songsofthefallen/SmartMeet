from __future__ import annotations

from schemas import RouteAlternative
from route_recommendation import build_route_recommendation


def route(route_id: str, duration: int, distance: int, **metrics: int | None) -> RouteAlternative:
    return RouteAlternative(
        route_id=route_id,
        duration_seconds=duration,
        duration_minutes=(duration + 59) // 60,
        distance_meters=distance,
        traffic_delay_seconds=metrics.get("traffic_delay_seconds"),
        no_traffic_travel_time_seconds=metrics.get("no_traffic_travel_time_seconds"),
        historic_traffic_travel_time_seconds=metrics.get("historic_traffic_travel_time_seconds"),
        live_traffic_incidents_travel_time_seconds=metrics.get("live_traffic_incidents_travel_time_seconds"),
    )


def test_fastest_valid_route_recommended_and_slower_alternative_explained() -> None:
    result = build_route_recommendation([route("0", 600, 5000), route("1", 1020, 7000)])
    assert result.recommended_route_id == "0"
    assert "shortest estimated travel time" in result.explanation
    assert "approximately 7 min faster" in result.explanation
    assert result.alternatives[0].reason_codes == ["slower_and_longer"]
    assert "7 min longer" in result.alternatives[0].explanation


def test_shorter_but_slower_alternative_is_described_as_tradeoff() -> None:
    result = build_route_recommendation([route("fast", 600, 9000), route("short", 780, 5000)])
    assert result.alternatives[0].reason_codes == ["shorter_but_slower"]
    assert "may suit a shorter-distance preference" in result.alternatives[0].explanation


def test_provider_traffic_delay_and_free_flow_data_are_reported_without_inventing_claims() -> None:
    result = build_route_recommendation([
        route("0", 1800, 6000, traffic_delay_seconds=240, no_traffic_travel_time_seconds=1500),
    ])
    assert result.traffic_information_available is True
    assert result.explanation == "Recommended because it is the only valid route available."
    missing = build_route_recommendation([route("0", 1800, 6000)])
    assert missing.traffic_information_available is False
    assert "traffic" not in missing.explanation.lower()


def test_historical_estimate_is_available_for_future_route_without_live_delay() -> None:
    historical = route("future", 1800, 6000, historic_traffic_travel_time_seconds=1740)
    result = build_route_recommendation([historical], route_time_basis="scheduled_departure")
    assert result.traffic_information_available is True
    assert historical.traffic_delay_seconds is None
    assert historical.no_traffic_travel_time_seconds is None


def test_free_flow_alone_is_not_traffic_information() -> None:
    result = build_route_recommendation([
        route("free-flow-only", 1800, 6000, no_traffic_travel_time_seconds=1800),
    ], route_time_basis="scheduled_departure")
    assert result.traffic_information_available is False


def test_current_route_distinguishes_live_and_historical_fields() -> None:
    result = build_route_recommendation([
        route("current", 1800, 6000, traffic_delay_seconds=60, historic_traffic_travel_time_seconds=1740),
    ])
    assert result.traffic_information_available is True


def test_historical_estimate_does_not_become_live_for_future_route() -> None:
    historical = route("future", 1800, 6000, historic_traffic_travel_time_seconds=1740, traffic_delay_seconds=60)
    result = build_route_recommendation([historical], route_time_basis="scheduled_departure")
    assert result.traffic_information_available is True


def test_invalid_routes_are_excluded_and_no_valid_routes_is_explicit() -> None:
    invalid = RouteAlternative.model_construct(route_id="bad", duration_seconds=0, distance_meters=0)
    result = build_route_recommendation([invalid, route("good", 900, 4000)])
    assert result.recommended_route_id == "good"
    none = build_route_recommendation([invalid])
    assert none.recommended_route_id is None
    assert none.reason_codes == ["no_valid_routes"]


def test_equal_duration_ties_keep_provider_order() -> None:
    result = build_route_recommendation([route("first", 900, 6000), route("second", 900, 4000)])
    assert result.recommended_route_id == "first"
    assert result.alternatives[0].reason_codes == ["equal_time_shorter_distance"]


def test_recommendation_stays_shortest_best_estimate_independent_of_user_selection() -> None:
    routes = [
        route("fastest", 600, 9000, historic_traffic_travel_time_seconds=540),
        route("selected-by-user", 720, 5000, historic_traffic_travel_time_seconds=700),
    ]
    result = build_route_recommendation(routes, route_time_basis="scheduled_departure")
    assert result.recommended_route_id == "fastest"

