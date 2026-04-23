// Business Tickets - Real-time Chat System
// This file handles all ticket-related functionality for business users

(function () {
  'use strict';

  // i18n strings
  const __NST =
    typeof window !== 'undefined' &&
    window.__NS_BUSINESS_I18N &&
    window.__NS_BUSINESS_I18N.tickets
      ? window.__NS_BUSINESS_I18N.tickets
      : {};

  // State management
  let socket;
  let currentTicketId = null;
  let currentFilter = 'all';
  let tickets = [];
  let typingTimeout;
  let isTyping = false;
  let attachedImage = null;
  let currentTypeFilter = 'all';
  let currentTicketStatus = null;

  const UPLOAD_URL = '/api/v1/upload/single';

  function escAttr(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function setRootView(view) {
    const root = document.getElementById('ticketsProRoot');
    if (root) root.setAttribute('data-tickets-view', view);
  }

  function updatePillCounts(counts) {
    if (!counts) return;
    document.querySelectorAll('[data-pill-count]').forEach((el) => {
      const k = el.getAttribute('data-pill-count');
      const n =
        k === 'all' ? counts.all : counts[k] != null ? counts[k] : 0;
      el.textContent = n > 0 ? ` ${n}` : '';
    });
  }

  function showCreatePanel() {
    const createPanel = document.getElementById('createTicketPanel');
    const emptyState = document.getElementById('emptyState');
    const chatContainer = document.getElementById('chatContainer');
    if (createPanel) {
      createPanel.classList.remove('hidden');
      createPanel.setAttribute('aria-hidden', 'false');
    }
    if (emptyState) emptyState.classList.add('hidden');
    if (chatContainer) {
      chatContainer.classList.add('hidden');
      chatContainer.setAttribute('aria-hidden', 'true');
    }
    setRootView('detail');
  }

  function hideCreatePanel() {
    const createPanel = document.getElementById('createTicketPanel');
    if (createPanel) {
      createPanel.classList.add('hidden');
      createPanel.setAttribute('aria-hidden', 'true');
    }
    if (currentTicketId) {
      document.getElementById('emptyState')?.classList.add('hidden');
      document.getElementById('chatContainer')?.classList.remove('hidden');
      document
        .getElementById('chatContainer')
        ?.setAttribute('aria-hidden', 'false');
      setRootView('detail');
    } else {
      document.getElementById('emptyState')?.classList.remove('hidden');
      document.getElementById('chatContainer')?.classList.add('hidden');
      document
        .getElementById('chatContainer')
        ?.setAttribute('aria-hidden', 'true');
      setRootView('list');
    }
  }

  function updateDescriptionCount() {
    const ta = document.getElementById('ticketDescription');
    const nEl = document.getElementById('ticketDescriptionCount');
    if (ta && nEl) {
      nEl.textContent = `${ta.value.length}/2000`;
    }
  }

  // Initialize Socket.IO connection
  function initSocket() {
    socket = io({
      auth: {
        businessPanel: true,
      },
    });

    socket.on('connect', () => {});

    socket.on('disconnect', () => {});

    socket.on('new_ticket_message', (data) => {
      if (data.ticketId === currentTicketId) {
        appendMessage(data.message);
        scrollToBottom();
      }
      loadTickets();
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

  // Load tickets from API
  async function loadTickets() {
    try {
      const params = new URLSearchParams();
      params.append('limit', '200');
      if (currentFilter !== 'all') {
        params.append('status', currentFilter);
      }
      if (currentTypeFilter !== 'all') params.append('ticketType', currentTypeFilter);

      const response = await fetch(`/api/v1/tickets?${params}`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        tickets = data.tickets;
        if (data.statusCounts) {
          updatePillCounts(data.statusCounts);
        }
        applyFilters();
      }
    } catch (error) {
      console.error('Error loading tickets:', error);
      showToast(__NST.errorLoading || 'Error loading tickets', 'error');
    }
  }

  function applyFilters() {
    const searchQuery = document.getElementById('searchTickets')?.value.toLowerCase() || '';

    let filtered = tickets;

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

  function getStatusPillClass(status) {
    if (!status) return 'tk-pill';
    return 'tk-pill tk-pill--' + String(status);
  }

  // Render ticket list
  function renderTickets(ticketsToRender) {
    const ticketList = document.getElementById('ticketList');

    const countEl = document.getElementById('ticketCount');
    if (countEl) {
      countEl.textContent = ticketsToRender.length;
    }

    if (ticketsToRender.length === 0) {
      ticketList.innerHTML = `
        <div class="tickets-pro__list-empty">
          <i class="ri-search-line" aria-hidden="true"></i>
          <p class="mb-0">${__NST.noTicketsFound || 'No tickets found'}</p>
        </div>
      `;
      return;
    }

    ticketList.innerHTML = ticketsToRender
      .map((ticket) => {
        const isActive = ticket._id === currentTicketId;
        const hasUnread = ticket.unreadCountBusiness > 0;
        const statusPill = getStatusPillClass(ticket.status);
        const desc = (ticket.description || '').replace(/\s+/g, ' ');

        return `
        <div class="ticket-item tickets-pro__card ${
          isActive ? 'is-active' : ''
        }"
             data-ticket-id="${ticket._id}">
          <div class="tickets-pro__card-top">
            <div class="tickets-pro__card-id">
              <span>#${escapeHtml(ticket.ticketNumber)}</span>
              ${
                hasUnread
                  ? `<span class="tickets-pro__unread-dot" title="${escapeHtml(
                      __NST.newBadge || 'New'
                    )}"></span>`
                  : ''
              }
            </div>
            <span class="${statusPill}">${escapeHtml(
          formatStatusLabel(ticket.status)
        )}</span>
          </div>
          <h3 class="tickets-pro__card-title">${escapeHtml(ticket.subject)}</h3>
          <p class="tickets-pro__card-preview">${escapeHtml(
            desc.length > 100 ? desc.substring(0, 100) + '…' : desc
          )}</p>
          <div class="tickets-pro__card-meta">
            <span>
              <i class="ri-price-tag-3-line" aria-hidden="true"></i>
              ${escapeHtml(formatTicketType(ticket.ticketType))}
            </span>
            <span>
              <i class="ri-time-line" aria-hidden="true"></i> ${formatDate(
            ticket.lastMessageAt || ticket.createdAt
          )}
            </span>
            ${
              ticket.relatedOrderNumber
                ? `<span><i class="ri-shopping-bag-line" aria-hidden="true"></i> ${escapeHtml(
                    ticket.relatedOrderNumber
                  )}</span>`
                : ''
            }
          </div>
        </div>
      `;
      })
      .join('');

    document.querySelectorAll('.ticket-item').forEach((item) => {
      item.addEventListener('click', function () {
        openTicket(this.dataset.ticketId);
      });
    });
  }

  async function openTicket(ticketId) {
    currentTicketId = ticketId;

    const createPanel = document.getElementById('createTicketPanel');
    if (createPanel) {
      createPanel.classList.add('hidden');
      createPanel.setAttribute('aria-hidden', 'true');
    }

    document.querySelectorAll('.ticket-item').forEach((item) => {
      item.classList.remove('is-active');
    });
    const activeItem = document.querySelector(
      `[data-ticket-id="${String(ticketId).replace(/"/g, '')}"]`
    );
    if (activeItem) {
      activeItem.classList.add('is-active');
    }

    const emptyState = document.getElementById('emptyState');
    const chatContainer = document.getElementById('chatContainer');

    if (emptyState) {
      emptyState.classList.add('hidden');
    }
    if (chatContainer) {
      chatContainer.classList.remove('hidden');
      chatContainer.setAttribute('aria-hidden', 'false');
    }

    setRootView('detail');

    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      chatMessages.innerHTML = '';
    }

    if (socket && socket.connected) {
      socket.emit('join_ticket', { ticketId });
      socket.emit('mark_messages_read', { ticketId });
    }

    await loadTicketDetails(ticketId);
    await loadMessages(ticketId);
  }

  async function loadTicketDetails(ticketId) {
    try {
      const response = await fetch(`/api/v1/tickets/${ticketId}`, {
        credentials: 'include',
      });
      const data = await response.json();

      if (data.success) {
        const ticket = data.ticket;
        currentTicketStatus = ticket.status;
        const titlePrefix = __NST.chatTitlePrefix || 'Ticket';
        document.getElementById('chatTitle').textContent = `${titlePrefix} #${ticket.ticketNumber} - ${ticket.subject}`;

        const st = getStatusPillClass(ticket.status);

        document.getElementById('chatInfo').innerHTML = `
          <span class="${st}">${escapeHtml(formatStatusLabel(ticket.status))}</span>
          <span class="tk-chip tk-chip--muted">${escapeHtml(
            formatTicketType(ticket.ticketType)
          )}</span>
          ${
            ticket.relatedOrderNumber
              ? `<span class="tk-chip tk-chip--muted"><i class="ri-shopping-bag-line" aria-hidden="true"></i> ${__NST.orderLabel || 'Order'}: ${escapeHtml(
                  ticket.relatedOrderNumber
                )}</span>`
              : ''
          }
        `;

        updateSendButtonState(ticket.status);
        updateRateUI(ticket);
      }
    } catch (error) {
      console.error('Error loading ticket details:', error);
    }
  }

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

  function appendMessage(message) {
    const chatMessages = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');

    const isOutgoing = message.senderType === 'business';
    const isSystem = message.senderType === 'system';

    if (isSystem) {
      messageDiv.className = 'tickets-pro__msg-system';
      messageDiv.innerHTML = `<span>${escapeHtml(message.content)}</span>`;
    } else {
      const initials = message.senderName
        ? message.senderName.substring(0, 2).toUpperCase()
        : '??';

      const hasImage = message.attachments && message.attachments.length > 0;
      const imageUrl = hasImage
        ? message.attachments[0].url || message.attachmentUrl || message.imageUrl
        : null;

      const textHtml = message.content
        ? `<p class="mb-0">${escapeHtml(message.content)}</p>`
        : '';
      const u = escAttr(imageUrl);
      const imgHtml =
        hasImage && imageUrl
          ? `<div class="mb-2">
            <a href="${u}" target="_blank" rel="noopener noreferrer" class="d-inline-block">
              <img src="${u}" alt="${escapeHtml(
            __NST.attachmentAlt || 'Attachment'
          )}" class="img-fluid rounded" style="max-width: 280px;">
            </a>
          </div>`
          : '';

      if (isOutgoing) {
        messageDiv.className = 'tickets-pro__msg-row tickets-pro__msg-row--out';
        messageDiv.innerHTML = `
          <div class="tickets-pro__msg-stack">
            <div class="tickets-pro__bubble tickets-pro__bubble--out">
              ${imgHtml}
              ${textHtml}
            </div>
            <span class="tickets-pro__msg-time">${formatTime(
              message.createdAt
            )}</span>
          </div>
        `;
      } else {
        messageDiv.className = 'tickets-pro__msg-row tickets-pro__msg-row--in';
        messageDiv.innerHTML = `
          <div class="tickets-pro__msg-av" aria-hidden="true">${escapeHtml(
            initials
          )}</div>
          <div class="tickets-pro__msg-stack">
            <span class="tickets-pro__msg-name">${escapeHtml(
              message.senderName || ''
            )}</span>
            <div class="tickets-pro__bubble tickets-pro__bubble--in">
              ${imgHtml}
              ${textHtml}
            </div>
            <span class="tickets-pro__msg-time">${formatTime(
              message.createdAt
            )}</span>
          </div>
        `;
      }
    }

    chatMessages.appendChild(messageDiv);
  }

  async function uploadImageToCloudinary(file) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'tickets');

      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const percentComplete = (e.loaded / e.total) * 100;
          updateUploadProgress(percentComplete);
        }
      };

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response = JSON.parse(xhr.responseText);
          updateUploadProgress(100);
          setTimeout(() => {
            updateUploadProgress(0);
          }, 500);
          resolve(response.url || response.secure_url);
        } else {
          reject(new Error('Upload failed'));
        }
      };

      xhr.onerror = function () {
        reject(new Error('Upload failed'));
      };

      xhr.open('POST', UPLOAD_URL, true);
      xhr.send(formData);
    });
  }

  function updateUploadProgress(percent) {
    const progressBars = document.querySelectorAll('.upload-progress-bar');
    progressBars.forEach((bar) => {
      bar.style.width = percent + '%';
      bar.style.display = percent > 0 && percent < 100 ? 'block' : 'none';
    });
  }

  function handleImageAttachment(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast(__NST.invalidImageFile || 'Please select a valid image file', 'error');
      return;
    }

    attachedImage = file;

    const preview = document.getElementById('attachmentPreview');
    const reader = new FileReader();

    reader.onload = function (e) {
      const previewItem = document.createElement('div');
      previewItem.className = 'attachment-preview-item';
      previewItem.innerHTML = `
        <img src="${e.target.result}" alt="${escapeHtml(__NST.imagePreviewAlt || 'Preview')}">
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

  window.removeAttachment = function () {
    clearAttachment();
  };

  function clearAttachment() {
    attachedImage = null;
    const prev = document.getElementById('attachmentPreview');
    if (prev) prev.innerHTML = '';
    const inp = document.getElementById('imageInput');
    if (inp) inp.value = '';
  }

  async function sendMessage() {
    const input = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    const content = input.value.trim();

    if (!content && !attachedImage) return;
    if (!currentTicketId) return;

    if (currentTicketStatus === 'closed' || currentTicketStatus === 'resolved') {
      showToast(
        __NST.cannotSendClosed ||
          'Cannot send messages to closed or resolved tickets',
        'error'
      );
      return;
    }

    const originalBtnHtml = sendBtn.innerHTML;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="ri-loader-4-line animate-spin"></i>';

    try {
      let imageUrl = null;
      if (attachedImage) {
        try {
          imageUrl = await uploadImageToCloudinary(attachedImage);
          clearAttachment();
        } catch (uploadError) {
          console.error('Upload failed:', uploadError);
          showToast(
            __NST.uploadFailed || 'Failed to upload image. Please try again.',
            'error'
          );
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
            attachmentUrl: imageUrl,
          }),
        }
      );

      const data = await response.json();

      if (!data.success) {
        showToast(
          data.message || __NST.errorSending || 'Failed to send message',
          'error'
        );
      } else {
        input.value = '';
      }
    } catch (error) {
      console.error('Error sending message:', error);
      showToast(__NST.errorSending || 'Failed to send message', 'error');
    } finally {
      sendBtn.disabled = false;
      sendBtn.innerHTML = originalBtnHtml;
    }
  }

  function showTypingIndicator(show) {
    let typingDiv = document.getElementById('typingIndicator');

    if (show && !typingDiv) {
      typingDiv = document.createElement('div');
      typingDiv.id = 'typingIndicator';
      typingDiv.className = 'tickets-pro__typing';
      typingDiv.innerHTML = `<em>${__NST.supportTyping || 'Support team is typing...'}</em>`;
      document.getElementById('chatMessages').appendChild(typingDiv);
      scrollToBottom();
    } else if (!show && typingDiv) {
      typingDiv.remove();
    }
  }

  async function createTicket() {
    const subject = document.getElementById('ticketSubject').value.trim();
    const ticketType = document.getElementById('ticketType').value;
    const description = document
      .getElementById('ticketDescription')
      .value.trim();
    const relatedOrder = document.getElementById('relatedOrder').value.trim();

    if (!subject || !ticketType || !description) {
      showToast(__NST.fillRequired || 'Please fill in all required fields', 'error');
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
          description,
          relatedOrderNumber: relatedOrder || null,
        }),
      });

      const data = await response.json();

      if (data.success) {
        document.getElementById('createTicketForm')?.reset();
        updateDescriptionCount();
        showToast(__NST.ticketCreated || 'Ticket created successfully', 'success');
        await loadTickets();
        openTicket(data.ticket._id);
      } else {
        showToast(data.message || __NST.createFailed || 'Failed to create ticket', 'error');
      }
    } catch (error) {
      console.error('Error creating ticket:', error);
      showToast(__NST.createFailed || 'Failed to create ticket', 'error');
    }
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function formatDate(date) {
    const d = new Date(date);
    const now = new Date();
    const diff = now - d;
    const locale = __NST.locale || 'en-US';

    if (diff < 60000) return __NST.justNow || 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}${__NST.minutesAgo || 'm ago'}`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}${__NST.hoursAgo || 'h ago'}`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}${__NST.daysAgo || 'd ago'}`;

    return d.toLocaleDateString(locale);
  }

  function formatTime(date) {
    const locale = __NST.locale || 'en-US';
    return new Date(date).toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatTicketType(type) {
    if (!type) return '';
    const labels = __NST.ticketTypeLabels;
    if (labels && typeof labels === 'object' && labels[type]) {
      return labels[type];
    }
    return String(type)
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function formatStatusLabel(status) {
    if (!status) return '';
    const labels = __NST.statusLabels;
    if (labels && typeof labels === 'object' && labels[status]) {
      return labels[status];
    }
    return String(status)
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function formatRatingStars(n) {
    const r = Math.min(5, Math.max(0, parseInt(n, 10) || 0));
    if (r < 1) return '\u2014';
    const full = '\u2605';
    const empty = '\u2606';
    return full.repeat(r) + empty.repeat(5 - r);
  }

  function ticketAlreadyRated(ticket) {
    if (!ticket) return false;
    if (ticket.ratedAt) return true;
    const r = Number(ticket.rating);
    return r >= 1 && r <= 5;
  }

  function canRateTicketNow(ticket) {
    if (!ticket) return false;
    if (ticketAlreadyRated(ticket)) return false;
    const s = ticket.status;
    return s === 'resolved' || s === 'closed';
  }

  function updateRateUI(ticket) {
    const btn = document.getElementById('rateTicketBtn');
    const labelEl = document.getElementById('rateTicketBtnLabel');
    const banner = document.getElementById('rateHintBanner');
    const actionWrap = document.getElementById('rateTicketActionWrap');
    if (!btn || !banner) return;

    const defaultLabel = __NST.rateTicketLabel || 'Rate';
    const ratedLabel = __NST.rateTicketLabelRated || 'Rated';

    const showRateChrome =
      ticketAlreadyRated(ticket) || canRateTicketNow(ticket);

    if (!showRateChrome) {
      banner.hidden = true;
      banner.innerHTML = '';
      banner.className = 'tickets-pro__rate-banner';
      if (actionWrap) actionWrap.setAttribute('hidden', '');
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.remove('tickets-pro__btn-rate--ready');
      btn.classList.add('tickets-pro__btn-rate--locked');
      if (labelEl) labelEl.textContent = defaultLabel;
      btn.removeAttribute('title');
      return;
    }

    if (actionWrap) actionWrap.removeAttribute('hidden');
    banner.hidden = false;
    banner.className = 'tickets-pro__rate-banner';
    btn.classList.remove('tickets-pro__btn-rate--ready', 'tickets-pro__btn-rate--locked');

    if (ticketAlreadyRated(ticket)) {
      banner.classList.add('tickets-pro__rate-banner--done');
      const starStr = formatRatingStars(ticket.rating);
      const line = (
        __NST.ratingThanksStars || 'Thank you! {stars} / 5.'
      ).replace('{stars}', starStr);
      banner.innerHTML = `
        <i class="ri-checkbox-circle-fill tickets-pro__rate-banner-icon" aria-hidden="true"></i>
        <div class="tickets-pro__rate-banner-text">
          <p class="tickets-pro__rate-banner-title mb-1">${escapeHtml(
            __NST.ratingAlreadyThanks || 'You already submitted a rating.'
          )}</p>
          <p class="tickets-pro__rate-banner-sub mb-0">${escapeHtml(line)}</p>
        </div>
      `;
      btn.disabled = true;
      btn.setAttribute('aria-disabled', 'true');
      btn.classList.add('tickets-pro__btn-rate--locked');
      if (labelEl) labelEl.textContent = ratedLabel;
      btn.title = __NST.ratingAlreadyThanks || '';
      return;
    }

    banner.classList.add('tickets-pro__rate-banner--ready');
    banner.innerHTML = `
      <i class="ri-star-smile-line tickets-pro__rate-banner-icon" aria-hidden="true"></i>
      <div class="tickets-pro__rate-banner-text">
        <p class="tickets-pro__rate-banner-sub mb-0">${escapeHtml(
          __NST.ratingCanRateHint ||
            'You can now rate your support experience using the Rate button above.'
        )}</p>
      </div>
    `;
    btn.disabled = false;
    btn.setAttribute('aria-disabled', 'false');
    btn.classList.add('tickets-pro__btn-rate--ready');
    if (labelEl) labelEl.textContent = defaultLabel;
    btn.title = __NST.titleRateTicket || 'Rate this ticket';
  }

  function updateSendButtonState(status) {
    const sendBtn = document.getElementById('sendBtn');
    const messageInput = document.getElementById('messageInput');
    const attachBtn = document.getElementById('attachImageBtn');

    if (status === 'closed' || status === 'resolved') {
      sendBtn.disabled = true;
      messageInput.disabled = true;
      attachBtn.disabled = true;
      messageInput.placeholder = (
        __NST.ticketClosedPlaceholder ||
        'This ticket is {status}. You cannot send messages.'
      ).replace('{status}', formatStatusLabel(status));
    } else {
      sendBtn.disabled = false;
      messageInput.disabled = false;
      attachBtn.disabled = false;
      messageInput.placeholder =
        __NST.sendPlaceholder || 'Type your message...';
    }
  }

  function scrollToBottom() {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
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

  function initEventListeners() {
    document
      .getElementById('createTicketBtn')
      ?.addEventListener('click', () => {
        showCreatePanel();
      });

    document
      .getElementById('emptyStateCreateBtn')
      ?.addEventListener('click', () => {
        showCreatePanel();
      });

    document
      .getElementById('createTicketBackBtn')
      ?.addEventListener('click', () => {
        hideCreatePanel();
      });

    document
      .getElementById('createTicketCancelBtn')
      ?.addEventListener('click', () => {
        hideCreatePanel();
      });

    document
      .getElementById('ticketsBackToList')
      ?.addEventListener('click', () => {
        setRootView('list');
      });

    document
      .getElementById('submitTicketBtn')
      ?.addEventListener('click', createTicket);

    document.getElementById('sendBtn')?.addEventListener('click', sendMessage);

    document
      .getElementById('attachImageBtn')
      ?.addEventListener('click', function () {
        document.getElementById('imageInput').click();
      });

    document
      .getElementById('imageInput')
      ?.addEventListener('change', function (e) {
        const file = e.target.files[0];
        if (file) {
          handleImageAttachment(file);
        }
      });

    document
      .getElementById('messageInput')
      ?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }

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

    document
      .getElementById('ticketDescription')
      ?.addEventListener('input', updateDescriptionCount);

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

    let searchTimeout;
    document
      .getElementById('searchTickets')
      ?.addEventListener('input', function () {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          applyFilters();
        }, 300);
      });

    document
      .getElementById('filterType')
      ?.addEventListener('change', function () {
        currentTypeFilter = this.value;
        loadTickets();
      });
  }

  let currentRating = 0;

  function initRatingStars() {
    const stars = document.querySelectorAll('#ratingStars .star');
    stars.forEach((star) => {
      star.addEventListener('click', function () {
        currentRating = parseInt(this.dataset.rating, 10);
        updateRatingDisplay(currentRating);
      });
      star.addEventListener('mouseenter', function () {
        const rating = parseInt(this.dataset.rating, 10);
        highlightStars(rating);
      });
    });

    document
      .getElementById('ratingStars')
      ?.addEventListener('mouseleave', function () {
        highlightStars(currentRating);
      });
  }

  function highlightStars(rating) {
    const stars = document.querySelectorAll('#ratingStars .star');
    const texts = {
      1: __NST.ratingPoor || 'Poor',
      2: __NST.ratingFair || 'Fair',
      3: __NST.ratingGood || 'Good',
      4: __NST.ratingVeryGood || 'Very Good',
      5: __NST.ratingExcellent || 'Excellent',
    };

    stars.forEach((star, index) => {
      if (index < rating) {
        star.classList.add('filled', 'active');
        star.classList.remove('ri-star-line');
        star.classList.add('ri-star-fill');
      } else {
        star.classList.remove('filled', 'active');
        star.classList.remove('ri-star-fill');
        star.classList.add('ri-star-line');
      }
    });

    const ratingText = document.getElementById('ratingText');
    if (ratingText) {
      ratingText.textContent =
        rating > 0
          ? texts[rating]
          : __NST.clickToRate || 'Click to rate';
    }
  }

  function updateRatingDisplay(rating) {
    highlightStars(rating);
  }

  async function submitRating() {
    if (!currentTicketId || !currentRating) {
      showToast(__NST.selectRating || 'Please select a rating', 'error');
      return;
    }

    const comment = document.getElementById('ratingComment')?.value || '';

    try {
      const response = await fetch(`/api/v1/tickets/${currentTicketId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rating: currentRating,
          comment: comment,
        }),
      });

      const data = await response.json();

      if (data.success) {
        showToast(
          __NST.thankYouFeedback || 'Thank you for your feedback!',
          'success'
        );
        const el = document.getElementById('rateTicketModal');
        if (el && window.bootstrap) {
          const m = window.bootstrap.Modal.getInstance(el) || new window.bootstrap.Modal(el);
          m.hide();
        }
        currentRating = 0;
        const rc = document.getElementById('ratingComment');
        if (rc) rc.value = '';
        highlightStars(0);
        if (currentTicketId) {
          await loadTicketDetails(currentTicketId);
        }
      } else {
        showToast(
          data.message || __NST.ratingFailed || 'Failed to submit rating',
          'error'
        );
      }
    } catch (error) {
      console.error('Error submitting rating:', error);
      showToast(__NST.ratingFailed || 'Failed to submit rating', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    setRootView('list');
    initSocket();
    initEventListeners();
    initRatingStars();
    updateDescriptionCount();
    loadTickets();

    document
      .getElementById('rateTicketBtn')
      ?.addEventListener('click', function () {
        if (this.disabled || this.getAttribute('aria-disabled') === 'true') {
          return;
        }
        if (currentTicketId) {
          const el = document.getElementById('rateTicketModal');
          if (el && window.bootstrap) {
            const m = window.bootstrap.Modal.getInstance(el) || new window.bootstrap.Modal(el);
            m.show();
          }
        }
      });

    document
      .getElementById('submitRatingBtn')
      ?.addEventListener('click', submitRating);
  });
})();
