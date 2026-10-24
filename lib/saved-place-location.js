function isValidCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function requestCurrentLocation(geolocation) {
  return new Promise((resolve, reject) => {
    if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
      reject(Object.assign(new Error("Location is unavailable in this browser."), { code: "unavailable" }));
      return;
    }
    geolocation.getCurrentPosition(
      ({ coords }) => {
        const { latitude, longitude } = coords;
        if (!isValidCoordinate(latitude, longitude)) {
          reject(Object.assign(new Error("The browser returned invalid coordinates."), { code: "unavailable" }));
          return;
        }
        resolve({ latitude, longitude });
      },
      (error) => {
        const code = error?.code === 1 ? "denied" : error?.code === 3 ? "timeout" : "unavailable";
        const message = code === "denied" ? "Location permission was denied. You can still search or choose a pin on the map."
          : code === "timeout" ? "The location request timed out. Try again or choose a pin on the map."
            : "Your current location is unavailable. You can still search or choose a pin on the map.";
        reject(Object.assign(new Error(message), { code }));
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 0 },
    );
  });
}

module.exports = { isValidCoordinate, requestCurrentLocation };
