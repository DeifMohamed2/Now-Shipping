// Business Tickets - Real-time Chat System
// This file handles all ticket-related functionality for business users

(function () {
  'use strict';

  // State management
  let socket;
  let currentTicketId = null;
  let currentFilter = 'all';
  let tickets = [];
  let typingTimeout;
  let isTyping = false;
  let attachedImage = null;
  let currentPriorityFilter = 'all';
  let currentTypeFilter = 'all';
  let currentTicketStatus = null;
  
  // Cloudinary configuration
  const CLOUDINARY_URL = 'https://api.cloudinary.com/v1_1/dusod9wxt/upload';
  const CLOUDINARY_UPLOAD_PRESET = 'order_project';

  // Initialize Socket.IO connection
  function initSocket() {
    // For web-based tickets, use businessPanel authentication
    socket = io({
      auth: {
        businessPanel: true, // Similar to adminPanel, authenticated via cookie/session
      },
    });

    // Socket event handlers
    socket.on('connect', () => {
      console.log('Socket connected successfully');
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    socket.on('new_ticket_message', (data) => {
      console.log('Received new_ticket_message event:', data);
      if (data.ticketId === currentTicketId) {
        console.log('Message is for current ticket, appending to UI');
        appendMessage(data.message);
        scrollToBottom();
      } else {
        console.log(
          'Message is for different ticket:',
          data.ticketId,
          'current:',
          currentTicketId
        );
      }
      loadTickets(); // Refresh ticket list
    });

    socket.on('ticket_updated', (data) => {
      loadTickets();
      if (data.ticketId === currentTicketId) {
        loadTicketDetails(currentTicketId);
      }
    });

    socket.on('user_typing', (data) => {
      if (data.userType !== 'business' && data.isTyping) {
        showTypingIndicator(true);
      } else {
        showTypingIndicator(false);
      }
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  }

  // Helper function to get cookie
  function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
  }

  // Load tickets from API
  async function loadTickets() {
    try {
      const params = new URLSearchParams();
      if (currentFilter !== 'all') {
        params.append('status', currentFilter);
      }
      if (currentPriorityFilter !== 'all') params.append('priority', currentPriorityFilter);
      if (currentTypeFilter !== 'all') params.append('ticketType', currentTypeFilter);

      const response = await fetch(`/api/v1/tickets?${params}`, {
        credentials: 'include', // Send cookies with request
      });
      const data = await response.json();

      if (data.success) {
        tickets = data.tickets;
        applyFilters();
      }
    } catch (error) {
      console.error('Error loading tickets:', error);
      showToast('Error loading tickets', 'error');
    }
  }

  // Apply all filters (search, priority, type)
  function applyFilters() {
    const searchQuery = document.getElementById('searchTickets')?.value.toLowerCase() || '';
    
    let filtered = tickets;

    // Apply search filter
    if (searchQuery) {
      filtered = filtered.filter(
        (ticket) =>
          ticket.ticketNumber.toLowerCase().includes(searchQuery) ||
          ticket.subject.toLowerCase().includes(searchQuery) ||
          (ticket.description || '').toLowerCase().includes(searchQuery) ||
          (ticket.relatedOrderNumber || '').toLowerCase().includes(searchQuery)
      );
    }

    renderTickets(filtered);
  }

  // Render ticket list
  function renderTickets(ticketsToRender) {
    const ticketList = document.getElementById('ticketList');

    if (ticketsToRender.length === 0) {
      ticketList.innerHTML = `
        <div class="text-center p-4">
          <i class="ri-inbox-line display-4 text-muted"></i>
          <p class="text-muted mt-2">No tickets found</p>
        </div>
      `;
      return;
    }

    ticketList.innerHTML = ticketsToRender
      .map((ticket) => {
        const isActive = ticket._id === currentTicketId;
        const hasUnread = ticket.unreadCountBusiness > 0;
        const statusClass = getStatusBadgeClass(ticket.status);

        return `
        <div class="ticket-item p-2 border-bottom ${
          isActive ? 'active bg-light' : ''
        }" 
             data-ticket-id="${ticket._id}" 
             style="cursor: pointer;">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div>
              <small class="text-muted">#${ticket.ticketNumber}</small>
              ${
                hasUnread ? '<span class="badge bg-danger ms-2">New</span>' : ''
              }
            </div>
            <span class="badge ${statusClass}">${ticket.status}</span>
          </div>
          <h6 class="mb-1">${escapeHtml(ticket.subject)}</h6>
          <p class="text-muted small mb-2">${escapeHtml(
            ticket.description
          ).substring(0, 80)}...</p>
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="d-flex gap-1">
              <span class="badge ${getPriorityBadgeClass(ticket.priority)} badge-sm">${
          ticket.priority || 'medium'
        }</span>
              <span class="badge bg-secondary badge-sm">${formatTicketType(ticket.ticketType)}</span>
            </div>
          </div>
          <div class="d-flex justify-content-between align-items-center">
            <small class="text-muted">
              <i class="ri-time-line"></i> ${formatDate(
                ticket.lastMessageAt || ticket.createdAt
              )}
            </small>
            ${
              ticket.relatedOrderNumber
                ? `<small class="text-muted"><i class="ri-shopping-bag-line"></i> ${ticket.relatedOrderNumber}</small>`
                : ''
            }
          </div>
        </div>
      `;
      })
      .join('');

    // Add click handlers
    document.querySelectorAll('.ticket-item').forEach((item) => {
      item.addEventListener('click', function () {
        openTicket(this.dataset.ticketId);
      });
    });
  }

  // Open ticket and load messages
  async function openTicket(ticketId) {
    currentTicketId = ticketId;

    // Update active state in ticket list
    document.querySelectorAll('.ticket-item').forEach((item) => {
      item.classList.remove('active', 'bg-light');
    });
    const activeItem = document.querySelector(`[data-ticket-id="${ticketId}"]`);
    if (activeItem) {
      activeItem.classList.add('active', 'bg-light');
    }

    // Hide empty state and show chat container
    const emptyState = document.getElementById('emptyState');
    const chatContainer = document.getElementById('chatContainer');

    if (emptyState) {
      emptyState.classList.add('hidden');
    }
    if (chatContainer) {
      chatContainer.classList.remove('hidden');
    }

    // Clear previous messages
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      chatMessages.innerHTML = '';
    }

    // Join socket room
    if (socket && socket.connected) {
      console.log('Joining ticket room:', ticketId);
      socket.emit('join_ticket', { ticketId });
      socket.emit('mark_messages_read', { ticketId });
    } else {
      console.log('Socket not connected, cannot join room');
    }

    // Load data
    await loadTicketDetails(ticketId);
    await loadMessages(ticketId);
  }

  // Load ticket details
  async function loadTicketDetails(ticketId) {
    try {
      const response = await fetch(`/api/v1/tickets/${ticketId}`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        const ticket = data.ticket;
        currentTicketStatus = ticket.status; // Store current status
        document.getElementById(
          'chatTitle'
        ).textContent = `#${ticket.ticketNumber} - ${ticket.subject}`;
        document.getElementById('chatInfo').innerHTML = `
          <span class="badge ${getStatusBadgeClass(ticket.status)}">${
          ticket.status
        }</span>
          <span class="text-muted ms-2">${formatTicketType(
            ticket.ticketType
          )}</span>
          <span class="text-muted ms-2">Priority: ${ticket.priority}</span>
          ${
            ticket.relatedOrderNumber
              ? `<span class="text-muted ms-2">Order: ${ticket.relatedOrderNumber}</span>`
              : ''
          }
        `;
        
        // Enable/disable send button based on status
        updateSendButtonState(ticket.status);
      }
    } catch (error) {
      console.error('Error loading ticket details:', error);
    }
  }

  // Load messages
  async function loadMessages(ticketId) {
    try {
      const response = await fetch(`/api/v1/tickets/${ticketId}/messages`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        const chatMessages = document.getElementById('chatMessages');
        chatMessages.innerHTML = '';

        data.messages.forEach((message) => {
          appendMessage(message);
        });

        scrollToBottom();
      }
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  }

  // Append message to chat
  function appendMessage(message) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');

    const isOutgoing = message.senderType === 'business';
    const isSystem = message.senderType === 'system';

    messageDiv.className = `mb-3 ${isOutgoing ? 'text-end' : ''}`;

    if (isSystem) {
      messageDiv.innerHTML = `
        <div class="text-center">
          <small class="badge bg-warning text-dark">${escapeHtml(
            message.content
          )}</small>
        </div>
      `;
    } else {
      const initials = message.senderName
        ? message.senderName.substring(0, 2).toUpperCase()
        : '??';

      const hasImage = message.attachments && message.attachments.length > 0;
      const imageUrl = hasImage ? (message.attachments[0].url || message.attachmentUrl || message.imageUrl) : null;
      
      messageDiv.innerHTML = `
        <div class="d-inline-block ${
          isOutgoing ? 'text-end' : 'text-start'
        }" style="max-width: 70%;">
          ${
            !isOutgoing
              ? `<small class="text-muted">${escapeHtml(
                  message.senderName
                )}</small>`
              : ''
          }
          <div class="card ${
            isOutgoing ? 'bg-primary text-white' : 'bg-light'
          } mb-1">
            <div class="card-body p-2">
              ${hasImage && imageUrl ? `
                <div class="mb-2">
                  <img src="${imageUrl}" 
                       alt="Attachment" 
                       class="img-fluid rounded"
                       style="max-width: 300px; cursor: pointer;"
                       onclick="window.open('${imageUrl}', '_blank')">
                </div>
              ` : ''}
              ${message.content ? `<p class="mb-0">${escapeHtml(message.content)}</p>` : ''}
            </div>
          </div>
          <small class="text-muted">${formatTime(message.createdAt)}</small>
        </div>
      `;
    }

    chatMessages.appendChild(messageDiv);
  }

  // Upload image to Cloudinary
  async function uploadImageToCloudinary(file) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

      const xhr = new XMLHttpRequest();
      
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          updateUploadProgress(percentComplete);
        }
      };

      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response = JSON.parse(xhr.responseText);
          updateUploadProgress(100);
          setTimeout(() => {
            updateUploadProgress(0);
          }, 500);
          resolve(response.secure_url);
        } else {
          reject(new Error('Upload failed'));
        }
      };

      xhr.onerror = function() {
        reject(new Error('Upload failed'));
      };

      xhr.open('POST', CLOUDINARY_URL, true);
      xhr.send(formData);
    });
  }

  // Update upload progress
  function updateUploadProgress(percent) {
    const progressBars = document.querySelectorAll('.upload-progress-bar');
    progressBars.forEach(bar => {
      bar.style.width = percent + '%';
      bar.style.display = percent > 0 && percent < 100 ? 'block' : 'none';
    });
  }

  // Handle image attachment
  function handleImageAttachment(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Please select a valid image file', 'error');
      return;
    }

    attachedImage = file;

    // Show preview
    const preview = document.getElementById('attachmentPreview');
    const reader = new FileReader();
    
    reader.onload = function(e) {
      const previewItem = document.createElement('div');
      previewItem.className = 'attachment-preview-item';
      previewItem.innerHTML = `
        <img src="${e.target.result}" alt="Preview">
        <div class="remove-attachment" onclick="removeAttachment()">
          <i class="ri-close-line"></i>
        </div>
        <div class="upload-progress-bar"></div>
      `;
      preview.innerHTML = '';
      preview.appendChild(previewItem);
    };

    reader.readAsDataURL(file);
  }

  // Remove attachment
  window.removeAttachment = function() {
    clearAttachment();
  };

  // Clear attachment
  function clearAttachment() {
    attachedImage = null;
    document.getElementById('attachmentPreview').innerHTML = '';
    document.getElementById('imageInput').value = '';
  }

  // Send message
  async function sendMessage() {
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const content = input.value.trim();

    if (!content && !attachedImage) return;
    if (!currentTicketId) return;

    // Check if ticket is closed or resolved
    if (currentTicketStatus === 'closed' || currentTicketStatus === 'resolved') {
      showToast('Cannot send messages to closed or resolved tickets', 'error');
      return;
    }

    // Disable send button and show loading
    const originalBtnHtml = sendBtn.innerHTML;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="ri-loader-4-line animate-spin"></i>';

    try {
      // If there's an attached image, upload it first
      let imageUrl = null;
      if (attachedImage) {
        try {
          imageUrl = await uploadImageToCloudinary(attachedImage);
          clearAttachment();
        } catch (uploadError) {
          console.error('Upload failed:', uploadError);
          showToast('Failed to upload image. Please try again.', 'error');
          sendBtn.disabled = false;
          sendBtn.innerHTML = originalBtnHtml;
          return;
        }
      }

      const response = await fetch(
        `/api/v1/tickets/${currentTicketId}/messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ 
            content, 
            messageType: imageUrl ? 'image' : 'text',
            attachmentUrl: imageUrl
          }),
        }
      );

      const data = await response.json();

      if (data.success) {
        input.value = '';
        // Message will be added via socket event (new_ticket_message)
        // No need to append here as socket broadcasts to all users including sender
      } else {
        showToast(data.message || 'Failed to send message', 'error');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      showToast('Failed to send message', 'error');
    } finally {
      // Re-enable send button
      sendBtn.disabled = false;
      sendBtn.innerHTML = originalBtnHtml;
    }
  }

  // Show typing indicator
  function showTypingIndicator(show) {
    let typingDiv = document.getElementById('typingIndicator');

    if (show && !typingDiv) {
      typingDiv = document.createElement('div');
      typingDiv.id = 'typingIndicator';
      typingDiv.className = 'text-muted small mb-2';
      typingDiv.innerHTML = '<em>Support team is typing...</em>';
      document.getElementById('chatMessages').appendChild(typingDiv);
      scrollToBottom();
    } else if (!show && typingDiv) {
      typingDiv.remove();
    }
  }

  // Create new ticket
  async function createTicket() {
    const subject = document.getElementById('ticketSubject').value.trim();
    const ticketType = document.getElementById('ticketType').value;
    const priority = document.getElementById('ticketPriority').value;
    const description = document
      .getElementById('ticketDescription')
      .value.trim();
    const relatedOrder = document.getElementById('relatedOrder').value.trim();

    if (!subject || !ticketType || !description) {
      showToast('Please fill in all required fields', 'error');
      return;
    }

    try {
      const response = await fetch('/api/v1/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          subject,
          ticketType,
          priority,
          description,
          relatedOrderNumber: relatedOrder || null,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Close modal
        const modal = bootstrap.Modal.getInstance(
          document.getElementById('createTicketModal')
        );
        modal.hide();

        // Reset form
        document.getElementById('createTicketForm').reset();

        showToast('Ticket created successfully', 'success');

        await loadTickets();
        openTicket(data.ticket._id);
      } else {
        showToast(data.message || 'Failed to create ticket', 'error');
      }
    } catch (error) {
      console.error('Error creating ticket:', error);
      showToast('Failed to create ticket', 'error');
    }
  }

  // Utility functions
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(date) {
    const d = new Date(date);
    const now = new Date();
    const diff = now - d;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    return d.toLocaleDateString();
  }

  function formatTime(date) {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatTicketType(type) {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function getStatusBadgeClass(status) {
    const classes = {
      new: 'bg-success',
      open: 'bg-primary',
      pending: 'bg-warning',
      in_progress: 'bg-info',
      resolved: 'bg-success',
      closed: 'bg-secondary',
    };
    return classes[status] || 'bg-secondary';
  }

  function getPriorityBadgeClass(priority) {
    const classes = {
      low: 'bg-info text-white',
      medium: 'bg-warning text-dark',
      high: 'bg-danger text-white',
      urgent: 'bg-danger text-white',
    };
    return classes[priority] || 'bg-secondary text-white';
  }

  function updateSendButtonState(status) {
    const sendBtn = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    const attachBtn = document.getElementById('attachImageBtn');
    
    if (status === 'closed' || status === 'resolved') {
      sendBtn.disabled = true;
      messageInput.disabled = true;
      attachBtn.disabled = true;
      messageInput.placeholder = 'This ticket is ' + status + '. You cannot send messages.';
    } else {
      sendBtn.disabled = false;
      messageInput.disabled = false;
      attachBtn.disabled = false;
      messageInput.placeholder = 'Type your message...';
    }
  }

  function scrollToBottom() {
    const chatMessages = document.getElementById('chatMessages');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showToast(message, type = 'info') {
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: type,
      title: message,
      showConfirmButton: false,
      timer: 3000,
    });
  }

  // Event listeners
  function initEventListeners() {
    // Create ticket button
    document
      .getElementById('createTicketBtn')
      ?.addEventListener('click', () => {
        const modal = new bootstrap.Modal(
          document.getElementById('createTicketModal')
        );
        modal.show();
      });

    // Submit ticket
    document
      .getElementById('submitTicketBtn')
      ?.addEventListener('click', createTicket);

    // Send message
    document.getElementById('sendBtn')?.addEventListener('click', sendMessage);

    // Image attachment handlers
    document.getElementById('attachImageBtn')?.addEventListener('click', function() {
      document.getElementById('imageInput').click();
    });

    document.getElementById('imageInput')?.addEventListener('change', function(e) {
      const file = e.target.files[0];
      if (file) {
        handleImageAttachment(file);
      }
    });

    // Send on Enter
    document
      .getElementById('messageInput')
      ?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }

        // Typing indicator
        if (socket && socket.connected && currentTicketId) {
          if (!isTyping) {
            socket.emit('ticket_typing', {
              ticketId: currentTicketId,
              isTyping: true,
            });
            isTyping = true;
          }

          clearTimeout(typingTimeout);
          typingTimeout = setTimeout(() => {
            socket.emit('ticket_typing', {
              ticketId: currentTicketId,
              isTyping: false,
            });
            isTyping = false;
          }, 1000);
        }
      });

    // Filter tabs
    document.querySelectorAll('.filter-tab').forEach((tab) => {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.filter-tab').forEach((t) => {
          t.classList.remove('active');
        });
        this.classList.add('active');
        currentFilter = this.dataset.status;
        loadTickets();
      });
    });

    // Search
    let searchTimeout;
    document
      .getElementById('searchTickets')
      ?.addEventListener('input', function () {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          applyFilters();
        }, 300);
      });

    // Priority filter
    document.getElementById('filterPriority')?.addEventListener('change', function () {
      currentPriorityFilter = this.value;
      loadTickets();
    });

    // Type filter
    document.getElementById('filterType')?.addEventListener('change', function () {
      currentTypeFilter = this.value;
      loadTickets();
    });
  }

  // Initialize on DOM ready
  document.addEventListener('DOMContentLoaded', function () {
    initSocket();
    initEventListeners();
    loadTickets();
  });
})();
