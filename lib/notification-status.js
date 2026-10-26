function permissionStatus(supported, permission) {
  if (!supported) return "Unsupported in this browser";
  if (permission === "granted") return "Granted in browser settings";
  if (permission === "denied") return "Blocked in browser settings";
  return "Not granted";
}

function browserSubscriptionStatus(supported, loadState, hasSubscription) {
  if (supported === null) return "Checking browser support";
  if (!supported) return "Unavailable";
  if (loadState === "loading") return "Checking this browser";
  if (loadState === "error") return "Could not check this browser";
  return hasSubscription ? "Subscription exists in this browser" : "No browser subscription";
}

function accountRegistrationStatus(registration) {
  if (registration === "registered") return "Registration confirmed in this session";
  if (registration === "not_registered") return "Removed from this account";
  if (registration === "error") return "Registration needs attention";
  return "Not verified";
}

function canSendTestNotification(pushState, registration) {
  return pushState === "enabled" && registration === "registered";
}

module.exports = { permissionStatus, browserSubscriptionStatus, accountRegistrationStatus, canSendTestNotification };
