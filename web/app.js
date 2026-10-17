// EMRS Web Client Application Logic
(function () {
  'use strict';

  let currentUser = null;
  let authToken = localStorage.getItem('emrs_token') || null;
  let allEvents = [];
  let activeCategory = '';

  // DOM Elements
  const navTabs = document.querySelectorAll('.nav-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  const eventGrid = document.getElementById('eventGrid');
  const eventCounter = document.getElementById('eventCounter');
  const searchInput = document.getElementById('searchInput');
  const categoryChips = document.querySelectorAll('.chip');
  const ticketsGrid = document.getElementById('ticketsGrid');

  // Auth Elements
  const authModal = document.getElementById('authModal');
  const btnOpenAuthModal = document.getElementById('btnOpenAuthModal');
  const modalClose = document.getElementById('modalClose');
  const modalBackdrop = document.getElementById('modalBackdrop');
  const modalTabLogin = document.getElementById('modalTabLogin');
  const modalTabRegister = document.getElementById('modalTabRegister');
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const userBadge = document.getElementById('userBadge');
  const userAvatar = document.getElementById('userAvatar');
  const userName = document.getElementById('userName');
  const userRoleBadge = document.getElementById('userRoleBadge');
  const btnLogout = document.getElementById('btnLogout');

  // Forms
  const createEventForm = document.getElementById('createEventForm');
  const eventDateInput = document.getElementById('eventDate');
  if (eventDateInput) {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    eventDateInput.min = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  const checkinTicketCode = document.getElementById('checkinTicketCode');
  const btnCheckInSubmit = document.getElementById('btnCheckInSubmit');
  const checkinResult = document.getElementById('checkinResult');
  const toastContainer = document.getElementById('toastContainer');

  // Toast Helper
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Tab Navigation
  navTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      navTabs.forEach((b) => b.classList.remove('active'));
      tabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetId = btn.getAttribute('data-tab');
      document.getElementById(targetId).classList.add('active');

      if (targetId === 'myTicketsTab') {
        loadMyTickets();
      }
    });
  });

  // Modal handlers
  function openModal(mode = 'login') {
    authModal.classList.add('active');
    switchAuthTab(mode);
  }

  function closeModal() {
    authModal.classList.remove('active');
  }

  function switchAuthTab(mode) {
    if (mode === 'login') {
      modalTabLogin.classList.add('active');
      modalTabRegister.classList.remove('active');
      loginForm.classList.add('active');
      registerForm.classList.remove('active');
    } else {
      modalTabRegister.classList.add('active');
      modalTabLogin.classList.remove('active');
      registerForm.classList.add('active');
      loginForm.classList.remove('active');
    }
  }

  btnOpenAuthModal.addEventListener('click', () => openModal('login'));
  modalClose.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', closeModal);
  modalTabLogin.addEventListener('click', () => switchAuthTab('login'));
  modalTabRegister.addEventListener('click', () => switchAuthTab('register'));

  // Update Auth State
  async function checkAuth() {
    if (!authToken) {
      currentUser = null;
      userBadge.style.display = 'none';
      btnOpenAuthModal.style.display = 'block';
      return;
    }
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        currentUser = data.user;
        userName.textContent = currentUser.name;
        userAvatar.textContent = currentUser.name.charAt(0).toUpperCase();
        userRoleBadge.textContent = currentUser.role;
        userBadge.style.display = 'flex';
        btnOpenAuthModal.style.display = 'none';
      } else {
        localStorage.removeItem('emrs_token');
        authToken = null;
        currentUser = null;
        userBadge.style.display = 'none';
        btnOpenAuthModal.style.display = 'block';
      }
    } catch {
      // Mock fallback if running without backend server
      currentUser = { id: 1, name: 'Avinash Julakatti', email: 'avinash@test.com', role: 'Attendee' };
      userName.textContent = currentUser.name;
      userAvatar.textContent = 'A';
      userRoleBadge.textContent = currentUser.role;
      userBadge.style.display = 'flex';
      btnOpenAuthModal.style.display = 'none';
    }
  }

  btnLogout.addEventListener('click', async () => {
    try {
      if (authToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` }
        });
      }
    } catch (e) {
      console.warn(e);
    }
    localStorage.removeItem('emrs_token');
    authToken = null;
    currentUser = null;
    showToast('Logged out successfully', 'info');
    checkAuth();
  });

  // Login Submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (res.ok) {
        authToken = data.token;
        localStorage.setItem('emrs_token', authToken);
        showToast('Signed in successfully!', 'success');
        closeModal();
        await checkAuth();
      } else {
        showToast(data.error || 'Login failed', 'error');
      }
    } catch (err) {
      showToast('Network error while signing in', 'error');
    }
  });

  // Register Submit
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('regName').value;
    const email = document.getElementById('regEmail').value;
    const phone = document.getElementById('regPhone').value;
    const role = document.getElementById('regRole').value;
    const password = document.getElementById('regPassword').value;

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, role, password })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Account created! Please sign in.', 'success');
        switchAuthTab('login');
      } else {
        showToast(data.error || 'Registration failed', 'error');
      }
    } catch (err) {
      showToast('Network error while registering', 'error');
    }
  });

  // Load Events
  async function loadEvents() {
    try {
      let url = '/api/events';
      const params = new URLSearchParams();
      if (activeCategory) params.append('category', activeCategory);
      if (searchInput.value.trim()) params.append('search', searchInput.value.trim());
      if (params.toString()) url += `?${params.toString()}`;

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        allEvents = data.events || [];
      } else {
        throw new Error();
      }
    } catch {
      // Seed default events if backend is starting
      allEvents = [
        {
          id: 1,
          title: 'National Tech Symposium 2026',
          description: 'A premiere technical symposium showcasing AI, Cloud Computing, and Agentic Systems innovations with keynote speakers from top tech firms.',
          category: 'Conference',
          date: '2026-11-15T09:30',
          venue: 'Main University Auditorium',
          capacity: 100,
          price: 0,
          registeredCount: 42,
          status: 'active'
        },
        {
          id: 2,
          title: 'Full-Stack C++ & Modern Web Workshop',
          description: 'Hands-on intensive workshop building high-performance microservices, REST APIs, and embedded web clients with automated testing.',
          category: 'Workshop',
          date: '2026-11-20T14:00',
          venue: 'Software Engineering Lab 4',
          capacity: 30,
          price: 199,
          registeredCount: 29,
          status: 'active'
        },
        {
          id: 3,
          title: 'Inter-College Hackathon — HackEMRS',
          description: '24-hour sprint to develop innovative solutions for digital campus infrastructure, community safety, and interactive education.',
          category: 'Technical',
          date: '2026-12-05T10:00',
          venue: 'Innovation Hub & Virtual',
          capacity: 60,
          price: 0,
          registeredCount: 60,
          status: 'active'
        }
      ];
    }
    renderEvents();
  }

  function renderEvents() {
    eventGrid.innerHTML = '';
    const filtered = allEvents.filter((ev) => {
      const matchCat = !activeCategory || ev.category.toLowerCase() === activeCategory.toLowerCase();
      const q = searchInput.value.toLowerCase().trim();
      const matchSearch =
        !q ||
        ev.title.toLowerCase().includes(q) ||
        ev.description.toLowerCase().includes(q) ||
        ev.venue.toLowerCase().includes(q);
      return matchCat && matchSearch;
    });

    eventCounter.textContent = `Showing ${filtered.length} event${filtered.length === 1 ? '' : 's'}`;

    if (filtered.length === 0) {
      eventGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-muted);">
          <p>No events found matching your search criteria.</p>
        </div>
      `;
      return;
    }

    filtered.forEach((ev) => {
      const isFull = ev.registeredCount >= ev.capacity;
      const formattedDate = new Date(ev.date).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const card = document.createElement('div');
      card.className = 'event-card';
      card.innerHTML = `
        <div>
          <div class="event-card-header">
            <span class="event-badge">${ev.category}</span>
            <span class="event-price-tag">${ev.price > 0 ? `₹${ev.price}` : 'FREE'}</span>
          </div>
          <h3>${ev.title}</h3>
          <p class="event-desc">${ev.description}</p>
        </div>
        <div>
          <div class="event-meta">
            <div class="meta-item">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>${formattedDate}</span>
            </div>
            <div class="meta-item">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              <span>${ev.venue}</span>
            </div>
            <div class="meta-item">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              <span>${ev.registeredCount} / ${ev.capacity} seats filled</span>
            </div>
          </div>
          <button class="btn-rsvp ${isFull ? 'full' : ''}" data-event-id="${ev.id}">
            ${isFull ? 'Join Waitlist' : 'Register for Event'}
          </button>
        </div>
      `;

      card.querySelector('.btn-rsvp').addEventListener('click', () => handleRegister(ev));
      eventGrid.appendChild(card);
    });
  }

  // Handle Event RSVP
  async function handleRegister(ev) {
    if (!currentUser) {
      showToast('Please sign in or create an account to register.', 'warning');
      openModal('login');
      return;
    }

    try {
      const res = await fetch(`/api/events/${ev.id}/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        }
      });
      const data = await res.json();
      if (res.ok) {
        if (data.status === 'confirmed') {
          showToast(`Success! Your ticket code is ${data.ticketCode}`, 'success');
        } else {
          showToast('Added to event waitlist. We will notify you when a slot frees up!', 'info');
        }
        loadEvents();
      } else {
        showToast(data.error || 'Registration failed', 'error');
      }
    } catch {
      showToast(`Registration simulated! Ticket code: EMRS-TKT-${Math.floor(1000 + Math.random() * 9000)}`, 'success');
    }
  }

  // Category & Search Filters
  categoryChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      categoryChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      activeCategory = chip.getAttribute('data-cat');
      renderEvents();
    });
  });

  searchInput.addEventListener('input', () => {
    renderEvents();
  });

  // Create Event Form
  createEventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser || currentUser.role !== 'Organizer') {
      showToast('Only organizers can create new events.', 'error');
      return;
    }

    const payload = {
      title: document.getElementById('eventTitle').value,
      category: document.getElementById('eventCategory').value,
      date: document.getElementById('eventDate').value,
      venue: document.getElementById('eventVenue').value,
      capacity: parseInt(document.getElementById('eventCapacity').value, 10),
      price: parseFloat(document.getElementById('eventPrice').value) || 0,
      description: document.getElementById('eventDescription').value
    };

    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Event published successfully!', 'success');
        createEventForm.reset();
        document.getElementById('tabBrowseEvents').click();
        loadEvents();
      } else {
        showToast(data.error || 'Failed to create event', 'error');
      }
    } catch {
      showToast('Event published (simulation)!', 'success');
      createEventForm.reset();
      document.getElementById('tabBrowseEvents').click();
    }
  });

  // Load My Tickets
  async function loadMyTickets() {
    ticketsGrid.innerHTML = '';
    if (!currentUser) {
      ticketsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-muted);">
          <p>Please sign in to view your tickets and event registrations.</p>
          <button class="btn-primary-sm" style="margin-top: 1rem;" onclick="document.getElementById('btnOpenAuthModal').click()">Sign In</button>
        </div>
      `;
      return;
    }

    try {
      const res = await fetch('/api/registrations/my', {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        const regs = data.registrations || [];
        if (regs.length === 0) {
          ticketsGrid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-muted);">
              <p>You have not registered for any events yet.</p>
            </div>
          `;
          return;
        }

        regs.forEach((reg) => {
          const card = document.createElement('div');
          card.className = 'ticket-card';
          card.innerHTML = `
            <div class="ticket-header">
              <span class="user-role-badge" style="background: ${reg.status === 'confirmed' ? 'var(--success)' : 'var(--accent)'}">${reg.status.toUpperCase()}</span>
              <span class="ticket-code">${reg.ticketCode || 'WAITLIST'}</span>
            </div>
            <h3>${reg.eventTitle}</h3>
            ${
              reg.ticketCode
                ? `
              <div class="ticket-qr">
                <div class="qr-box" title="${reg.ticketCode}"></div>
              </div>
              <p style="text-align: center; font-size: 0.8rem; color: var(--text-muted);">Scan this QR at venue admission</p>
            `
                : '<p style="margin: 1.5rem 0; color: var(--text-muted);">You are on the waitlist. You will receive an e-ticket when a slot opens.</p>'
            }
          `;
          ticketsGrid.appendChild(card);
        });
      }
    } catch {
      // Mock ticket display for preview
      ticketsGrid.innerHTML = `
        <div class="ticket-card">
          <div class="ticket-header">
            <span class="user-role-badge" style="background: var(--success)">CONFIRMED</span>
            <span class="ticket-code">EMRS-84B2</span>
          </div>
          <h3>National Tech Symposium 2026</h3>
          <div class="ticket-qr">
            <div class="qr-box"></div>
          </div>
          <p style="text-align: center; font-size: 0.8rem; color: var(--text-muted);">Scan this QR at venue admission</p>
        </div>
      `;
    }
  }

  // Check-in Scanner
  btnCheckInSubmit.addEventListener('click', async () => {
    const code = checkinTicketCode.value.trim().toUpperCase();
    if (!code) {
      showToast('Please enter a ticket code', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/tickets/checkin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ ticketCode: code })
      });
      const data = await res.json();
      if (res.ok) {
        checkinResult.className = 'checkin-result success';
        checkinResult.innerHTML = `
          <strong>Check-in Successful!</strong><br>
          Attendee: ${data.attendeeName || 'Registered Guest'}<br>
          Event: ${data.eventTitle || 'EMRS Event'}
        `;
        showToast('Attendee checked in successfully!', 'success');
      } else {
        checkinResult.className = 'checkin-result error';
        checkinResult.innerHTML = `<strong>Check-in Failed:</strong> ${data.error || 'Invalid ticket code'}`;
        showToast(data.error || 'Check-in failed', 'error');
      }
    } catch {
      checkinResult.className = 'checkin-result success';
      checkinResult.innerHTML = `<strong>Simulation:</strong> Ticket <code>${code}</code> validated for entry!`;
      showToast('Ticket validated (simulated)!', 'success');
    }
  });

  // Initialize
  checkAuth();
  loadEvents();
})();
