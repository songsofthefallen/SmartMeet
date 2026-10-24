function savedPlacesViewState(loading, error, hasPlaces) {
  if (loading) return "loading";
  if (error) return "error";
  return hasPlaces ? "list" : "empty";
}

module.exports = { savedPlacesViewState };
