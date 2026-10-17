function shouldInvalidateLocationSelection(selectedLocation, nextDescription) {
  return Boolean(selectedLocation) && nextDescription !== selectedLocation.name;
}

module.exports = { shouldInvalidateLocationSelection };
