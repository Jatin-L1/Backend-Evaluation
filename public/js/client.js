document.addEventListener('DOMContentLoaded', () => {
  console.log('Poll client script initialized');
  
  // Get poll ID from URL
  const pollId = window.location.pathname.split('/')[2];
  
  // Connect to Socket.io
  const socket = io();
  
  // Create vote locations container if it doesn't exist
  let voteLocationsContainer = document.querySelector('.vote-locations');
  if (!voteLocationsContainer) {
    voteLocationsContainer = document.createElement('div');
    voteLocationsContainer.className = 'vote-locations';
    document.body.appendChild(voteLocationsContainer);
  }
  
  // Function to get user's location
  async function getUserLocation() {
    try {
      // Try IP geolocation service
      const response = await fetch('https://ipapi.co/json/');
      if (response.ok) {
        const locationData = await response.json();
        return {
          city: locationData.city || 'Unknown City',
          region: locationData.region || 'Unknown Region',
          country: locationData.country_name || 'Unknown Country'
        };
      } else {
        throw new Error('Failed to fetch location data');
      }
    } catch (error) {
      console.error('Error getting IP location:', error);
      
      // Try browser geolocation as fallback
      if (navigator.geolocation) {
        return new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                city: 'Unknown City',
                country: 'Unknown Country'
              });
            },
            (err) => {
              console.warn('Browser geolocation error:', err);
              resolve({ city: 'Unknown Location', country: 'Unknown' });
            },
            { timeout: 5000 }
          );
        });
      } else {
        return { city: 'Unknown Location', country: 'Unknown' };
      }
    }
  }
  
  // Function to display vote location notification
  function displayVoteLocation(location, optionText) {
    const locationElement = document.createElement('div');
    locationElement.className = 'vote-location-alert';
    
    let locationText = location?.city || 'Unknown Location';
    if (location?.country && location?.city !== 'Unknown Location') {
      locationText = `${location.city}, ${location.country}`;
    }
    
    locationElement.innerHTML = `
      <div class="location-icon">📍</div>
      <div class="location-details">
        <div class="location-text">Vote from ${locationText}</div>
        ${optionText ? `<div class="voted-for">Voted for: ${optionText}</div>` : ''}
      </div>
    `;
    
    voteLocationsContainer.appendChild(locationElement);
    
    // Remove after 5 seconds
    setTimeout(() => {
      locationElement.classList.add('fade-out');
      setTimeout(() => locationElement.remove(), 500);
    }, 5000);
  }
  
  // Socket connection event
  socket.on('connect', () => {
    console.log('Connected to socket server');
    
    // Join poll room
    if (pollId) {
      socket.emit('joinPoll', pollId);
      console.log('Joined poll room:', pollId);
    }
  });
  
  // Handle poll updates (including votes with location)
  socket.on('updatePoll', (data) => {
    console.log('Received poll update:', data);
    
    if (data.pollId === pollId) {
      // Update vote counts if options are available
      if (data.options) {
        document.querySelectorAll('.votes').forEach((span, i) => {
          if (data.options[i]) {
            span.textContent = `(${data.options[i].votes})`;
          }
        });
      }
      
      // Display vote location if available
      if (data.location) {
        let optionText = null;
        
        // Try to get option text if option index is provided
        if (data.optionIndex !== undefined) {
          const options = document.querySelectorAll('.vote-btn');
          if (options[data.optionIndex]) {
            optionText = options[data.optionIndex].textContent;
          }
        }
        
        displayVoteLocation(data.location, optionText || data.optionText);
      }
    }
  });
  
  // Handle vote button clicks
  // Update the vote button click handler (find this section in your code)
document.querySelectorAll('.vote-btn').forEach((btn, index) => {
  btn.addEventListener('click', async (e) => {
    if (btn.disabled) return;
    
    try {
      // Disable button to prevent multiple clicks
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = 'Voting...';
      
      // Get user's location
      const location = await getUserLocation();
      console.log('User location for vote:', location);
      
      // Ensure location is properly formatted
      const locationData = {
        city: location?.city || 'Unknown City',
        country: location?.country || 'Unknown Country',
        latitude: location?.latitude || null,
        longitude: location?.longitude || null
      };
      
      console.log('Sending vote with location data:', locationData);
      
      // Send vote to server WITH location data
      const response = await fetch(`/poll/${pollId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          optionIndex: index,
          location: locationData // Explicitly formatted location
        })
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to vote');
      }
      
      const data = await response.json();
      console.log('Vote response:', data);
      
      // Check if location was saved
      if (data.locationSaved) {
        console.log('Location data was successfully saved');
      } else {
        console.warn('Location data was not saved');
      }
      
      // Disable all buttons
      document.querySelectorAll('.vote-btn').forEach(button => {
        button.disabled = true;
      });
      
      // Change text back
      btn.textContent = 'Voted';
      
      // Also emit via socket as a backup
      socket.emit('vote', {
        pollId,
        optionIndex: index,
        location: locationData,
        optionText: originalText
      });
      
      showNotification('Vote recorded successfully!', 'success');
      
    } catch (error) {
      console.error('Error voting:', error);
      btn.disabled = false;
      btn.textContent = btn.getAttribute('data-original-text') || 'Vote';
      showNotification(error.message || 'Error voting', 'error');
    }
  });
  
  // Store original text
  btn.setAttribute('data-original-text', btn.textContent);
});
  // Notification function
  function showNotification(message, type = 'info') {
    let container = document.querySelector('.notification-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'notification-container';
      document.body.appendChild(container);
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    container.appendChild(notification);
    
    setTimeout(() => {
      notification.classList.add('fade-out');
      setTimeout(() => notification.remove(), 300);
    }, 4000);
  }
});