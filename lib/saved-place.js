/**
 * @param {import("./schedule-api").SavedPlace} place
 * @returns {import("./schedule-api").LocationSelection}
 */
function savedPlaceLocation(place) {
  return {
    name: place.display_name,
    locality: place.locality,
    region: place.region,
    country: place.country,
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone,
  };
}

module.exports = { savedPlaceLocation };
