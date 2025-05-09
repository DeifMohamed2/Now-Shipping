// Map Location Selection Functionality
let map;
let previewMap;
let marker;
let previewMarker;
let geocoder;
let autocomplete;
let selectedLocation = {
  lat: 30.0444, // Default to Cairo, Egypt
  lng: 31.2357
};

// Initialize the map
function initMap() {
  // Initialize main map
  map = new google.maps.Map(document.getElementById("map"), {
    center: selectedLocation,
    zoom: 12,
    mapTypeControl: true,
    streetViewControl: true,
  });

  // Initialize preview map (smaller, static map)
  previewMap = new google.maps.Map(document.getElementById("previewMap"), {
    center: selectedLocation,
    zoom: 12,
    mapTypeControl: false,
    streetViewControl: false,
    zoomControl: false,
    fullscreenControl: false,
    draggable: false,
  });

  // Initialize geocoder for address lookups
  geocoder = new google.maps.Geocoder();

  // Initialize markers
  marker = new google.maps.Marker({
    map: map,
    draggable: true,
    animation: google.maps.Animation.DROP,
  });
  
  previewMarker = new google.maps.Marker({
    map: previewMap,
    draggable: false,
    animation: google.maps.Animation.DROP,
  });

  // Add event listener for map clicks
  map.addListener("click", (event) => {
    placeMarker(event.latLng);
  });

  // Add event listener for marker drag end
  marker.addListener("dragend", () => {
    selectedLocation = {
      lat: marker.getPosition().lat(),
      lng: marker.getPosition().lng()
    };
    
    // Reverse geocode to get address details
    geocoder.geocode({ location: selectedLocation }, (results, status) => {
      if (status === "OK" && results[0]) {
        updateAddressFields(results[0]);
        updateLocationText(results[0].formatted_address);
      } else {
        updateLocationText();
      }
    });
  });

  // Setup Places Autocomplete for search
  const searchInput = document.getElementById("mapSearch");
  autocomplete = new google.maps.places.Autocomplete(searchInput, {
    types: ["geocode"]
  });

  // Bind autocomplete to map
  autocomplete.bindTo("bounds", map);
  
  // Handle place selection
  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    
    if (!place.geometry || !place.geometry.location) {
      // User entered the name of a place that was not suggested
      return;
    }

    // Set the map to the selected place
    if (place.geometry.viewport) {
      map.fitBounds(place.geometry.viewport);
    } else {
      map.setCenter(place.geometry.location);
      map.setZoom(17);
    }
    
    // Place marker and update location
    placeMarker(place.geometry.location);
    
    // Update address fields based on the place
    updateAddressFields(place);
  });
  
  // Setup manual search button click
  document.getElementById("searchMapBtn").addEventListener("click", () => {
    const address = document.getElementById("mapSearch").value;
    if (address) {
      geocodeAddress(address);
    }
  });

  // Handle Enter key in search box
  document.getElementById("mapSearch").addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      event.preventDefault(); // Prevent form submission
      const address = document.getElementById("mapSearch").value;
      if (address) {
        geocodeAddress(address);
      }
    }
  });

  // Add event listener for when the map modal is opened
  const locationModal = document.getElementById('locationModal');
  if (locationModal) {
    locationModal.addEventListener('shown.bs.modal', function () {
      // Trigger a resize event to make sure the map renders correctly
      window.dispatchEvent(new Event('resize'));
      
      // If we have an existing marker position, center on it
      if (marker.getPosition()) {
        map.setCenter(marker.getPosition());
      }
      
      // Reset search input
      document.getElementById("mapSearch").value = '';
      
      // Make sure the map is ready
      google.maps.event.trigger(map, 'resize');
    });
  }

  // If we have stored coordinates, set the marker there
  const storedCoords = document.getElementById("locationCoordinates").value;
  if (storedCoords) {
    try {
      const coords = JSON.parse(storedCoords);
      selectedLocation = coords;
      marker.setPosition(coords);
      map.setCenter(coords);
      
      // Also update preview map
      previewMarker.setPosition(coords);
      previewMap.setCenter(coords);
      
      updateLocationText();
      document.getElementById("confirmLocation").disabled = false;
      
      // Display the selected location in the UI
      const selectedLocationSpan = document.getElementById("selectedLocation");
      if (selectedLocationSpan) {
        selectedLocationSpan.style.display = "block";
        geocoder.geocode({ location: coords }, (results, status) => {
          if (status === "OK" && results[0]) {
            selectedLocationSpan.querySelector("span").textContent = results[0].formatted_address;
          } else {
            selectedLocationSpan.querySelector("span").textContent = `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`;
          }
        });
      }
    } catch (e) {
      console.error("Error parsing stored coordinates:", e);
    }
  }
}

// Place a marker on the map
function placeMarker(location) {
  marker.setPosition(location);
  map.setCenter(location);
  
  selectedLocation = {
    lat: location.lat(),
    lng: location.lng()
  };
  
  // Reverse geocode to get address details whenever we place a marker
  geocoder.geocode({ location: selectedLocation }, (results, status) => {
    if (status === "OK" && results[0]) {
      updateAddressFields(results[0]);
      updateLocationText(results[0].formatted_address);
    } else {
      updateLocationText(`${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}`);
    }
  });
  
  document.getElementById("confirmLocation").disabled = false;
}

// Geocode an address to coordinates
function geocodeAddress(address) {
  geocoder.geocode({ address: address }, (results, status) => {
    if (status === "OK") {
      map.setCenter(results[0].geometry.location);
      placeMarker(results[0].geometry.location);
      updateAddressFields(results[0]);
    } else {
      alert("Geocode was not successful for the following reason: " + status);
    }
  });
}

// Update address fields based on geocoded result
function updateAddressFields(place) {
  let country = '';
  let city = '';
  let state = '';
  let district = '';
  let addressDetail = '';
  
  // Clear fields first to avoid partial updates when changing locations
  document.getElementById("address-details").value = '';
  
  console.log('Address components:', place.address_components);
  
  // Extract address components from place
  if (place.address_components) {
    for (const component of place.address_components) {
      const componentType = component.types[0];
      console.log(`Component: ${component.long_name}, Type: ${componentType}`);

      switch (componentType) {
        case "country":
          country = component.long_name;
          break;
        case "administrative_area_level_1":
          // This is usually the governorate/state
          state = component.long_name;
          break;
        case "locality":
          // This is the city name
          city = component.long_name;
          break;
        case "administrative_area_level_2":
          // This can be a more specific region
          if (!state) state = component.long_name;
          break;
        case "sublocality_level_1":
        case "sublocality":
          // This is district/area within a city
          district = component.long_name;
          break;
        case "route":
          // This is the street name
          addressDetail = component.long_name;
          break;
        case "street_number":
          // Add street number to address if available
          if (addressDetail) {
            addressDetail = component.long_name + ' ' + addressDetail;
          } else {
            addressDetail = component.long_name;
          }
          break;
      }
    }

    // Collect address details from the formatted address if we don't have specifics
    if (!addressDetail && place.formatted_address) {
      // Use the first part of the formatted address (before the first comma)
      const addressParts = place.formatted_address.split(',');
      if (addressParts.length > 0) {
        addressDetail = addressParts[0].trim();
      }
    }

    // Build more complete address details
    let fullAddress = [];
    if (addressDetail) fullAddress.push(addressDetail);
    if (district && !addressDetail.includes(district)) fullAddress.push(district);
    
    // Always update the address details field
    document.getElementById("address-details").value = fullAddress.join(', ');

    // Update country field
    if (country) {
      const countrySelect = document.getElementById("country");
      for (let i = 0; i < countrySelect.options.length; i++) {
        if (countrySelect.options[i].value.toLowerCase() === country.toLowerCase() ||
            countrySelect.options[i].text.toLowerCase() === country.toLowerCase()) {
          countrySelect.selectedIndex = i;
          break;
        }
      }
    }
    
    // Priority for region selection: state > city > district
    const regionToUse = state || city || district;
    
    // Update region/city field with a more comprehensive matching algorithm
    if (regionToUse) {
      // Try to match region name with options in the region select
      const regionSelect = document.getElementById("region");
      let found = false;
      
      // Create a list of possible region names to match against from most to least specific
      const possibleRegions = [];
      if (state) possibleRegions.push(state);
      if (city) possibleRegions.push(city);
      if (district) possibleRegions.push(district);
      
      // This allows us to try multiple possible region names
      for (const regionName of possibleRegions) {
        // First try: direct match
        for (let i = 0; i < regionSelect.options.length; i++) {
          if (i === 0) continue; // Skip the first "Select Region..." option
          
          const optionText = regionSelect.options[i].text.toLowerCase();
          const regionLower = regionName.toLowerCase();
          
          // Check for exact or close matches
          if (optionText === regionLower || 
              optionText.includes(regionLower) || 
              regionLower.includes(optionText)) {
            regionSelect.selectedIndex = i;
            found = true;
            console.log(`Found region match: ${regionSelect.options[i].text} for ${regionName}`);
            
            // When region is selected, also update the zone dropdown
            updateZoneBasedOnRegion(regionSelect.options[i].value, district);
            break;
          }
        }
        
        if (found) break; // Exit if we found a match
      }
      
      // If we didn't find any matches, try a fuzzy approach to find the best option
      if (!found) {
        let bestMatchIndex = 0;
        let bestMatchScore = 0;
        
        for (let i = 1; i < regionSelect.options.length; i++) {
          const optionText = regionSelect.options[i].text.toLowerCase();
          
          for (const regionName of possibleRegions) {
            const regionLower = regionName.toLowerCase();
            let score = 0;
            
            // Different scoring methods
            // 1. Word overlap
            const optWords = optionText.split(/\s+/);
            const regionWords = regionLower.split(/\s+/);
            
            for (const optWord of optWords) {
              if (optWord.length > 2) {
                for (const regionWord of regionWords) {
                  if (regionWord.length > 2) {
                    // Exact word match
                    if (optWord === regionWord) {
                      score += 10;
                    }
                    // Partial word match
                    else if (optWord.includes(regionWord) || regionWord.includes(optWord)) {
                      score += 5;
                    }
                  }
                }
              }
            }
            
            // 2. Character overlap
            if (optionText.includes(regionLower) || regionLower.includes(optionText)) {
              score += 3;
            }
            
            // Update best match if this score is better
            if (score > bestMatchScore) {
              bestMatchScore = score;
              bestMatchIndex = i;
            }
          }
        }
        
        // Use the best match if it has a reasonable score
        if (bestMatchScore > 0) {
          regionSelect.selectedIndex = bestMatchIndex;
          console.log(`Using fuzzy match: ${regionSelect.options[bestMatchIndex].text} with score ${bestMatchScore}`);
          
          // When region is selected, also update the zone dropdown
          updateZoneBasedOnRegion(regionSelect.options[bestMatchIndex].value, district);
        }
      }
    }
  }
  
  // Always log what we're updating to for debugging
  console.log('Updated fields:', {
    country: document.getElementById("country").value,
    region: document.getElementById("region").value,
    address: document.getElementById("address-details").value
  });
}

// Function to update zone dropdown based on selected region and district
function updateZoneBasedOnRegion(regionValue, district) {
  const zoneSelect = document.getElementById("zone");
  if (!zoneSelect) return;
  
  // Skip processing if the region is "Other"
  if (regionValue.toLowerCase() === "other") {
    zoneSelect.selectedIndex = 0;
    return;
  }
  
  console.log(`Updating zones for region: ${regionValue}`);
  
  // First hide all options in all optgroups
  const allOptions = zoneSelect.querySelectorAll('option');
  allOptions.forEach(option => {
    option.style.display = 'none';
  });
  
  // Show only the first "Select Zone" option
  if (allOptions.length > 0) {
    allOptions[0].style.display = '';
  }
  
  // First show only the optgroups that match the region
  const optgroups = zoneSelect.querySelectorAll('optgroup');
  let matchingOptgroups = [];
  
  // Hide all optgroups first
  optgroups.forEach(group => {
    group.style.display = 'none';
  });
  
  // Then show only those that match exactly
  optgroups.forEach(group => {
    const label = group.getAttribute('label') || '';
    const cityAttribute = group.getAttribute('data-city');
    
    // Always hide the "Other Regions" optgroup
    if (label.includes("Other Regions") || (cityAttribute && cityAttribute.toLowerCase() === "other")) {
      return;
    }
    
    // Very strict matching logic for regions
    const selectedRegionLower = regionValue.toLowerCase();
    
    // Check exact matches for the selected region
    let isMatch = false;
    
    // Match by data-city attribute (must be exact)
    if (cityAttribute && cityAttribute.toLowerCase() === selectedRegionLower) {
      isMatch = true;
    } else {
      // Match by label prefix with strict format checking
      const labelLower = label.toLowerCase();
      if (labelLower.startsWith(selectedRegionLower + " -") || 
          labelLower.startsWith(selectedRegionLower + "-")) {
        
        // Additional check - split the label and verify first part matches exactly
        const labelParts = labelLower.split(/[-\s]/);
        if (labelParts[0] === selectedRegionLower) {
          isMatch = true;
        }
      }
    }
    
    if (isMatch) {
      console.log(`Showing optgroup: ${label}`);
      group.style.display = '';
      
      // Show all options within this optgroup
      const options = group.querySelectorAll('option');
      options.forEach(option => {
        option.style.display = '';
      });
      
      matchingOptgroups.push(group);
    }
  });
  
  // Reset to default option
  zoneSelect.selectedIndex = 0;
  
  // If we have a district name, try to match it with zone options across all matching optgroups
  if (district && matchingOptgroups.length > 0) {
    const districtLower = district.toLowerCase();
    let bestMatchOption = null;
    let bestMatchScore = 0;
    
    // Process all options in all matching optgroups
    matchingOptgroups.forEach(optgroup => {
      const options = optgroup.querySelectorAll('option');
      
      options.forEach(option => {
        const optionText = option.text.toLowerCase();
        let score = 0;
        
        // Exact match
        if (optionText === districtLower) {
          score = 100;
        }
        // Partial word match
        else if (optionText.includes(districtLower) || districtLower.includes(optionText)) {
          score = 50;
        }
        // Word similarity
        else {
          const optWords = optionText.split(/\s+/);
          const distWords = districtLower.split(/\s+/);
          
          for (const optWord of optWords) {
            for (const distWord of distWords) {
              if (optWord.length > 2 && distWord.length > 2) {
                if (optWord === distWord) {
                  score += 10;
                } else if (optWord.includes(distWord) || distWord.includes(optWord)) {
                  score += 5;
                }
              }
            }
          }
        }
        
        // Update best match if this score is better
        if (score > bestMatchScore) {
          bestMatchScore = score;
          bestMatchOption = option;
        }
      });
    });
    
    // If we found a good match, select it
    if (bestMatchScore > 0 && bestMatchOption) {
      console.log(`Selected zone: ${bestMatchOption.text} with score ${bestMatchScore}`);
      // We need to use value instead of index as indices might not be consecutive with optgroups
      zoneSelect.value = bestMatchOption.value;
    }
  }
}

// Update the text showing the selected location
function updateLocationText(locationText) {
  if (!locationText) {
    // Reverse geocode to get address if no text provided
    geocoder.geocode({ location: selectedLocation }, (results, status) => {
      let text = `${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}`;
      
      if (status === "OK" && results[0]) {
        text = results[0].formatted_address;
        // Update address fields from geocode result
        updateAddressFields(results[0]);
      }
      
      document.getElementById("selectedLocationText").textContent = text;
    });
  } else {
    // Use provided text directly
    document.getElementById("selectedLocationText").textContent = locationText;
  }
}

// Handle the confirmation button click
document.addEventListener("DOMContentLoaded", function() {
  const confirmButton = document.getElementById("confirmLocation");
  
  confirmButton.addEventListener("click", function() {
    // Save the coordinates to the hidden input
    document.getElementById("locationCoordinates").value = JSON.stringify(selectedLocation);
    
    // Update the display text below the select location button
    const selectedLocationSpan = document.getElementById("selectedLocation");
    selectedLocationSpan.style.display = "block";
    
    geocoder.geocode({ location: selectedLocation }, (results, status) => {
      let locationText = `${selectedLocation.lat.toFixed(6)}, ${selectedLocation.lng.toFixed(6)}`;
      
      if (status === "OK" && results[0]) {
        locationText = results[0].formatted_address;
        // Make sure address fields are updated one last time
        updateAddressFields(results[0]);
      }
      
      // Store location text in a data attribute for later use during form submission
      document.getElementById("locationCoordinates").setAttribute("data-location-text", locationText);
      selectedLocationSpan.querySelector("span").textContent = locationText;
      
      // Update preview map with selected location
      previewMarker.setPosition(selectedLocation);
      previewMap.setCenter(selectedLocation);
      
      // Close the modal
      const modal = bootstrap.Modal.getInstance(document.getElementById("locationModal"));
      modal.hide();
    });
  });
});

// Add an event listener to the region select to update zones when changed
document.addEventListener('DOMContentLoaded', function() {
  const regionSelect = document.getElementById('region');
  if (regionSelect) {
    regionSelect.addEventListener('change', function() {
      console.log(`Region changed to: ${this.value}`);
      updateZoneBasedOnRegion(this.value, '');
    });
  }
});

// Add an event listener to the region select to update zones when changed
document.addEventListener('DOMContentLoaded', function() {
  const regionSelect = document.getElementById('region');
  const zoneSelect = document.getElementById('zone');
  
  if (regionSelect) {
    // Add animation class when selecting a region
    regionSelect.addEventListener('change', function() {
      const selectedRegion = this.value;
      console.log(`Region changed to: ${selectedRegion}`);
      
      if (zoneSelect) {
        zoneSelect.classList.add('loading-zones');
        
        // Add a small delay to show the loading animation
        setTimeout(() => {
          updateZoneBasedOnRegion(selectedRegion, '');
          zoneSelect.classList.remove('loading-zones');
          
          // Add highlighting to the dropdown to draw attention
          zoneSelect.classList.add('zones-updated');
          setTimeout(() => {
            zoneSelect.classList.remove('zones-updated');
          }, 1000);
        }, 300);
      }
    });
    
    // Add custom styling for better interaction
    if (zoneSelect) {
      // Focus and hover effects
      zoneSelect.addEventListener('focus', () => {
        document.querySelector('.zone-select-wrapper')?.classList.add('focused');
      });
      
      zoneSelect.addEventListener('blur', () => {
        document.querySelector('.zone-select-wrapper')?.classList.remove('focused');
      });
      
      // Selection feedback
      zoneSelect.addEventListener('change', () => {
        const selectedValue = zoneSelect.value;
        if (selectedValue) {
          console.log(`Zone selected: ${selectedValue}`);
          document.querySelector('.zone-select-wrapper')?.classList.add('has-value');
        } else {
          document.querySelector('.zone-select-wrapper')?.classList.remove('has-value');
        }
      });
    }
  }
  
  // Initialize zones based on preselected region if any
  if (regionSelect && regionSelect.value) {
    updateZoneBasedOnRegion(regionSelect.value, '');
  }
}); 