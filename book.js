(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const tenantId = params.get('tenant');
  const prefillEmail = params.get('email');
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const SLOT_OPTIONS = [
    { value: '08:00', label: '8:00 AM', detail: 'Early start' },
    { value: '10:00', label: '10:00 AM', detail: 'Mid-morning' },
    { value: '13:00', label: '1:00 PM', detail: 'After lunch' },
    { value: '15:30', label: '3:30 PM', detail: 'Late afternoon' },
    { value: '18:00', label: '6:00 PM', detail: 'Evening' },
  ];
  const state = {
    view: 'month',
    anchor: null,
    selected: '',
    userPicked: false,
    cache: new Map(),
    days: new Map(),
  };

  const els = {
    bizName: document.getElementById('bizName'),
    heroStatus: document.getElementById('heroStatus'),
    heroView: document.getElementById('heroView'),
    bookingDate: document.getElementById('bookingDate'),
    bookingStart: document.getElementById('bookingStart'),
    bookingDuration: document.getElementById('bookingDuration'),
    preferredTime: document.getElementById('preferredTime'),
    bookBtn: document.getElementById('btnBook'),
    bookMsg: document.getElementById('bookMsg'),
    pricingNote: document.getElementById('pricingNote'),
    pricingContact: document.getElementById('pricingContact'),
    rangeLabel: document.getElementById('rangeLabel'),
    rangeMeta: document.getElementById('rangeMeta'),
    selectedDayLabel: document.getElementById('selectedDayLabel'),
    selectedDayMeta: document.getElementById('selectedDayMeta'),
    openDaysCount: document.getElementById('openDaysCount'),
    openDaysMeta: document.getElementById('openDaysMeta'),
    blockedDaysCount: document.getElementById('blockedDaysCount'),
    blockedDaysMeta: document.getElementById('blockedDaysMeta'),
    availabilityFeedback: document.getElementById('availabilityFeedback'),
    scheduleBoard: document.getElementById('scheduleBoard'),
    timeSlotGrid: document.getElementById('timeSlotGrid'),
    slotHint: document.getElementById('slotHint'),
    successView: document.getElementById('successView'),
    successDetail: document.getElementById('successDetail'),
    bookForm: document.getElementById('bookForm'),
  };

  if (prefillEmail) document.getElementById('customerEmail').value = prefillEmail;

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function parseDateKey(value) {
    const parts = String(value || '').split('-').map(Number);
    return parts.length === 3 && parts.every(Number.isFinite)
      ? new Date(parts[0], parts[1] - 1, parts[2])
      : null;
  }

  function addDays(date, count) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + count);
    return next;
  }

  function addMonths(date, count) {
    return new Date(date.getFullYear(), date.getMonth() + count, 1);
  }

  function addYears(date, count) {
    return new Date(date.getFullYear() + count, 0, 1);
  }

  function startOfWeek(date) {
    return addDays(date, -date.getDay());
  }

  function startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function startOfYear(date) {
    return new Date(date.getFullYear(), 0, 1);
  }

  function endOfYear(date) {
    return new Date(date.getFullYear(), 11, 31);
  }

  function showDate(value, options) {
    const parsed = parseDateKey(value);
    return parsed ? parsed.toLocaleDateString(undefined, options) : value;
  }

  function isPast(value) {
    return value < dateKey(new Date());
  }

  function sanitizeTelHref(value) {
    const digits = String(value || '').replace(/[^\d+]/g, '');
    return digits ? `tel:${digits}` : '';
  }

  function inferPreferredTimeWindow(value) {
    const hour = Number(String(value || '').split(':')[0] || 0);
    if (hour < 12) return 'Morning (8am-12pm)';
    if (hour < 17) return 'Afternoon (12pm-5pm)';
    return 'Evening (5pm-8pm)';
  }

  function activeDay() {
    return state.days.get(state.selected) || null;
  }

  function setInlineMessage(element, text, kind) {
    element.className = 'book-msg';
    element.textContent = text || '';
    if (text && kind) element.classList.add(kind);
  }

  function setFeedback(text, kind) {
    els.availabilityFeedback.className = 'book-feedback';
    els.availabilityFeedback.textContent = text;
    if (kind) els.availabilityFeedback.classList.add(kind);
  }

  function viewRange() {
    if (state.view === 'day') {
      const key = dateKey(state.anchor);
      return {
        start: key,
        end: key,
        label: showDate(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
        meta: 'A focused single-day view for quick decisions.',
      };
    }

    if (state.view === 'week') {
      const start = startOfWeek(state.anchor);
      const end = addDays(start, 6);
      return {
        start: dateKey(start),
        end: dateKey(end),
        label: `${showDate(dateKey(start), { month: 'short', day: 'numeric' })} - ${showDate(dateKey(end), { month: 'short', day: 'numeric', year: 'numeric' })}`,
        meta: 'Compare the next seven days side by side.',
      };
    }

    if (state.view === 'year') {
      const start = startOfYear(state.anchor);
      const end = endOfYear(state.anchor);
      return {
        start: dateKey(start),
        end: dateKey(end),
        label: String(state.anchor.getFullYear()),
        meta: 'Scan the year and jump into the right month.',
      };
    }

    const start = startOfMonth(state.anchor);
    const end = endOfMonth(state.anchor);
    return {
      start: dateKey(start),
      end: dateKey(end),
      label: state.anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      meta: 'The best balance between overview and detail.',
    };
  }

  async function loadRange(start, end) {
    const key = `${start}:${end}`;
    if (state.cache.has(key)) return state.cache.get(key);

    const res = await fetch(
      `/.netlify/functions/get-availability?tenant_id=${encodeURIComponent(tenantId)}&start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Availability could not be checked.');

    (data.days || []).forEach((day) => state.days.set(day.date, day));
    state.cache.set(key, data);
    return data;
  }

  async function ensureDateLoaded(value) {
    if (state.days.has(value)) return state.days.get(value);
    const data = await loadRange(value, value);
    return (data.days || [])[0] || null;
  }

  function syncSelection(data) {
    const inRange = state.selected && state.selected >= data.window.start_date && state.selected <= data.window.end_date;
    if (!state.selected || !inRange) state.selected = data.summary.first_available_date || data.window.start_date;

    if (!state.userPicked) {
      const preferred = state.days.get(state.selected);
      if (!preferred || !preferred.available) state.selected = data.summary.first_available_date || data.window.start_date;
    }

    els.bookingDate.value = state.selected;
    els.bookingDate.min = dateKey(new Date());
  }

  function renderSummary(range, data) {
    const day = activeDay();

    els.rangeLabel.textContent = range.label;
    els.rangeMeta.textContent = range.meta;
    els.selectedDayLabel.textContent = day
      ? showDate(day.date, { weekday: 'long', month: 'long', day: 'numeric' })
      : 'Choose a date';
    els.selectedDayMeta.textContent = day
      ? (day.available ? 'This date is open for requests.' : (day.reason || 'This date is unavailable.'))
      : 'We will sync the form as you browse.';
    els.openDaysCount.textContent = String(data.summary.available_days);
    els.openDaysMeta.textContent = data.summary.first_available_date
      ? `First open day: ${showDate(data.summary.first_available_date, { month: 'short', day: 'numeric' })}.`
      : 'No open days were found in this view.';
    els.blockedDaysCount.textContent = String(data.summary.blocked_days);
    els.blockedDaysMeta.textContent = data.summary.blocked_days
      ? 'Unavailable dates are highlighted before submission.'
      : 'Nothing blocked in this view right now.';

    els.heroStatus.textContent = day
      ? `${showDate(day.date, { month: 'short', day: 'numeric' })} at ${els.bookingStart.value || '--:--'}`
      : 'Select a day';
    els.heroView.textContent = `${state.view.charAt(0).toUpperCase()}${state.view.slice(1)} view`;
  }

  function bindBoard() {
    els.scheduleBoard.querySelectorAll('[data-date]').forEach((button) => {
      button.addEventListener('click', async () => {
        const value = button.getAttribute('data-date');
        state.userPicked = true;
        state.selected = value;
        state.anchor = parseDateKey(value);
        await renderScheduler();
      });
    });

    els.scheduleBoard.querySelectorAll('[data-month]').forEach((button) => {
      button.addEventListener('click', async () => {
        state.view = 'month';
        state.anchor = parseDateKey(button.getAttribute('data-month'));
        state.userPicked = false;
        document.querySelectorAll('[data-view]').forEach((tab) => {
          tab.classList.toggle('active', tab.getAttribute('data-view') === 'month');
        });
        await renderScheduler();
      });
    });
  }

  function renderBoard(data) {
    if (state.view === 'day') {
      const day = activeDay();
      els.scheduleBoard.innerHTML = day
        ? `<button type="button" class="book-monthbtn ${day.available ? 'open' : 'blocked'} book-selected" data-date="${day.date}"><strong>${showDate(day.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</strong><div class="book-status">${day.available ? 'This day is open for appointment requests.' : (day.reason || 'This day is unavailable.')}</div></button>`
        : '';
      bindBoard();
      return;
    }

    if (state.view === 'week') {
      els.scheduleBoard.innerHTML = `<div class="book-weekgrid">${(data.days || []).map((day) => `
        <button type="button" class="book-weekbtn ${day.available ? 'open' : 'blocked'} ${state.selected === day.date ? 'book-selected' : ''} ${isPast(day.date) ? 'book-past' : ''}" data-date="${day.date}" ${isPast(day.date) ? 'disabled' : ''}>
          <strong>${showDate(day.date, { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
          <div class="book-status">${day.available ? 'Open for requests' : (day.reason || 'Unavailable')}</div>
        </button>
      `).join('')}</div>`;
      bindBoard();
      return;
    }

    if (state.view === 'year') {
      const year = parseDateKey(data.window.start_date).getFullYear();
      const months = Array.from({ length: 12 }, (_, index) => {
        const key = `${year}-${String(index + 1).padStart(2, '0')}`;
        const days = (data.days || []).filter((day) => day.date.startsWith(key));
        const open = days.filter((day) => day.available).length;
        const blocked = days.length - open;
        const anchor = `${key}-01`;
        return `
          <button type="button" class="book-yearbtn ${open ? 'open' : 'blocked'} ${state.selected.startsWith(key) ? 'book-selected' : ''}" data-month="${anchor}">
            <strong>${new Date(year, index, 1).toLocaleDateString(undefined, { month: 'long' })}</strong>
            <div class="book-status">${open ? `${open} open days` : 'No open days found'}</div>
            <div class="book-status">${blocked} blocked day${blocked === 1 ? '' : 's'}</div>
          </button>
        `;
      });
      els.scheduleBoard.innerHTML = `<div class="book-yeargrid">${months.join('')}</div>`;
      bindBoard();
      return;
    }

    const monthStart = parseDateKey(data.window.start_date);
    const leading = monthStart.getDay();
    const pads = Array.from({ length: leading }, () => '<div class="book-pad" aria-hidden="true"></div>').join('');
    const days = (data.days || []).map((day) => {
      const parsed = parseDateKey(day.date);
      return `
        <button type="button" class="book-daybtn ${day.available ? 'open' : 'blocked'} ${state.selected === day.date ? 'book-selected' : ''} ${isPast(day.date) ? 'book-past' : ''}" data-date="${day.date}" ${isPast(day.date) ? 'disabled' : ''}>
          <div class="book-daynum"><span>${parsed.getDate()}</span><small>${DAY_NAMES[parsed.getDay()]}</small></div>
          <div class="book-status">${day.available ? 'Open for requests' : (day.reason || 'Unavailable')}</div>
        </button>
      `;
    }).join('');
    els.scheduleBoard.innerHTML = `
      <div class="book-weekdays">${DAY_NAMES.map((day) => `<span>${day}</span>`).join('')}</div>
      <div class="book-monthgrid">${pads}${days}</div>
    `;
    bindBoard();
  }

  function renderSlots(data) {
    const day = activeDay();
    const disabled = !day || !day.available;
    const active = els.bookingStart.value || '09:00';

    els.slotHint.textContent = disabled
      ? 'Pick an open date to unlock time suggestions.'
      : 'Tap a slot to prefill the request, or type a custom time below.';
    els.timeSlotGrid.innerHTML = SLOT_OPTIONS.map((slot) => `
      <button type="button" class="book-slotbtn ${slot.value === active ? 'active' : ''}" data-slot="${slot.value}" ${disabled ? 'disabled' : ''}>
        <strong>${slot.label}</strong>
        <span>${slot.detail}</span>
      </button>
    `).join('');

    els.timeSlotGrid.querySelectorAll('[data-slot]').forEach((button) => {
      button.addEventListener('click', () => {
        const value = button.getAttribute('data-slot');
        els.bookingStart.value = value;
        els.preferredTime.value = inferPreferredTimeWindow(value);
        renderSummary(viewRange(), data);
        renderSlots(data);
      });
    });
  }

  function renderAvailability(data) {
    const day = activeDay();
    if (!day) {
      setFeedback('Choose a day to see availability details.', 'bad');
      els.bookBtn.disabled = true;
      return;
    }

    if (day.available) {
      let message = 'This day is open for appointment requests. The business will still confirm the final appointment shortly.';
      if (data.notes) message += ` ${data.notes}`;
      setFeedback(message, 'good');
      els.bookBtn.disabled = false;
      return;
    }

    let message = day.reason || 'This date is not available for booking.';
    if (data.summary.first_available_date) {
      message += ` Try ${showDate(data.summary.first_available_date, { weekday: 'short', month: 'short', day: 'numeric' })} instead.`;
    }
    setFeedback(message, 'bad');
    els.bookBtn.disabled = true;
  }

  function currentRangeData() {
    const range = viewRange();
    return state.cache.get(`${range.start}:${range.end}`) || null;
  }

  async function renderScheduler() {
    if (!tenantId) {
      setFeedback('This booking page is missing business information. Please ask for a fresh link.', 'bad');
      els.bookBtn.disabled = true;
      return;
    }

    const range = viewRange();
    const data = await loadRange(range.start, range.end);
    syncSelection(data);
    renderSummary(range, data);
    renderBoard(data);
    renderSlots(data);
    renderAvailability(data);
  }

  async function loadTenant() {
    if (!tenantId) {
      els.bizName.textContent = 'Schedule with us';
      return;
    }

    try {
      const res = await fetch(`/.netlify/functions/get-public-tenant-info?tenant_id=${encodeURIComponent(tenantId)}`);
      const data = await res.json().catch(() => ({}));
      const name = data.business_name || 'Schedule with us';
      els.bizName.textContent = name;
      document.title = `Request an appointment with ${name}`;

      const phone = data.phone || data.business_phone;
      const email = data.email || data.business_email;
      if (!phone && !email) return;

      els.pricingContact.textContent = '';
      const links = [];
      if (phone) {
        const phoneLink = document.createElement('a');
        phoneLink.href = sanitizeTelHref(phone);
        phoneLink.textContent = phone;
        links.push(phoneLink);
      }
      if (email) {
        const emailLink = document.createElement('a');
        emailLink.href = `mailto:${email}`;
        emailLink.textContent = email;
        links.push(emailLink);
      }
      links.forEach((link, index) => {
        els.pricingContact.append(index === 0 ? ' at ' : ' or ');
        els.pricingContact.appendChild(link);
      });
      els.pricingNote.style.display = 'block';
    } catch (_) {
      els.bizName.textContent = 'Schedule with us';
    }
  }

  document.querySelectorAll('[data-view]').forEach((tab) => {
    tab.addEventListener('click', async () => {
      state.view = tab.getAttribute('data-view');
      state.userPicked = false;
      document.querySelectorAll('[data-view]').forEach((node) => node.classList.toggle('active', node === tab));
      await renderScheduler().catch((err) => setFeedback(err.message || 'We could not confirm availability right now.', 'bad'));
    });
  });

  document.getElementById('schedulePrev').addEventListener('click', () => {
    state.anchor = state.view === 'day'
      ? addDays(state.anchor, -1)
      : state.view === 'week'
        ? addDays(state.anchor, -7)
        : state.view === 'year'
          ? addYears(state.anchor, -1)
          : addMonths(state.anchor, -1);
    state.userPicked = false;
    renderScheduler().catch((err) => setFeedback(err.message || 'We could not confirm availability right now.', 'bad'));
  });

  document.getElementById('scheduleNext').addEventListener('click', () => {
    state.anchor = state.view === 'day'
      ? addDays(state.anchor, 1)
      : state.view === 'week'
        ? addDays(state.anchor, 7)
        : state.view === 'year'
          ? addYears(state.anchor, 1)
          : addMonths(state.anchor, 1);
    state.userPicked = false;
    renderScheduler().catch((err) => setFeedback(err.message || 'We could not confirm availability right now.', 'bad'));
  });

  els.bookingDate.addEventListener('change', async function () {
    if (!this.value) return;
    state.selected = this.value;
    state.anchor = parseDateKey(this.value);
    state.userPicked = true;
    await ensureDateLoaded(this.value);
    await renderScheduler().catch((err) => setFeedback(err.message || 'We could not confirm availability right now.', 'bad'));
  });

  els.bookingStart.addEventListener('change', function () {
    if (!els.preferredTime.value) els.preferredTime.value = inferPreferredTimeWindow(this.value);
    const data = currentRangeData();
    if (data) {
      renderSummary(viewRange(), data);
      renderSlots(data);
    }
  });

  els.bookingDuration.addEventListener('change', function () {
    const data = currentRangeData();
    if (data) renderSummary(viewRange(), data);
  });

  document.getElementById('btnBook').addEventListener('click', function () {
    const name = document.getElementById('customerName').value.trim();
    const email = document.getElementById('customerEmail').value.trim();
    const title = document.getElementById('bookingTitle').value.trim();
    const date = els.bookingDate.value;
    const time = els.bookingStart.value;
    const duration = parseInt(els.bookingDuration.value, 10);
    const day = activeDay();
    const rawNotes = document.getElementById('bookingNotes').value.trim();
    const serviceAddress = [
      document.getElementById('serviceAddress').value.trim(),
      document.getElementById('serviceCity').value.trim(),
      document.getElementById('serviceState').value.trim(),
      document.getElementById('serviceZip').value.trim(),
    ].filter(Boolean).join(', ');

    setInlineMessage(els.bookMsg, '', '');

    if (!name || !title || !date || !time) {
      setInlineMessage(els.bookMsg, 'Please fill in all required fields.', 'error');
      return;
    }
    if (!tenantId) {
      setInlineMessage(els.bookMsg, 'This booking page is missing business information. Please ask for a fresh link.', 'error');
      return;
    }
    if (!day || !day.available) {
      setInlineMessage(els.bookMsg, (day && day.reason) || 'Please choose an available date before sending the request.', 'error');
      return;
    }

    const localStart = new Date(`${date}T${time}:00`);
    if (!Number.isFinite(localStart.getTime()) || localStart.getTime() < (Date.now() - 60000)) {
      setInlineMessage(els.bookMsg, 'Please choose a time in the future.', 'error');
      return;
    }

    const startsAt = localStart.toISOString();
    const endsAt = new Date(new Date(startsAt).getTime() + duration * 60000).toISOString();

    els.bookBtn.disabled = true;
    els.bookBtn.textContent = 'Sending...';

    fetch('/.netlify/functions/create-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenantId,
        customer_name: name,
        customer_email: email || undefined,
        title,
        starts_at: startsAt,
        ends_at: endsAt,
        preferred_time: els.preferredTime.value || undefined,
        referral_source: document.getElementById('referralSource').value || undefined,
        notes: rawNotes || undefined,
        service_address: serviceAddress || undefined,
      }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, status: res.status, data })))
      .then((result) => {
        if (!result.ok) {
          const errMsg = result.data && result.data.error;
          if (result.status >= 500) throw new Error('We hit a snag on our end. Please try again in a moment.');
          if (errMsg && /duplicate|already.book/i.test(errMsg)) throw new Error('Looks like you may have already booked this. Check your confirmation email.');
          if (errMsg && /unavailable|not available/i.test(errMsg)) throw new Error('That date just became unavailable. Please choose another option.');
          throw new Error(errMsg || 'We could not send your request. Please try again.');
        }

        els.bookForm.classList.add('hidden');
        els.successView.classList.remove('hidden');
        els.successDetail.textContent =
          `We received your request for ${showDate(date, { weekday: 'long', month: 'long', day: 'numeric' })} at ${localStart.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. The business will confirm the final appointment shortly.`;
      })
      .catch((err) => {
        setInlineMessage(
          els.bookMsg,
          err instanceof TypeError
            ? 'Connection problem. Your request was not sent. Check your internet and try again.'
            : (err.message || 'Something went wrong. Please try again or contact the business directly.'),
          'error'
        );
        els.bookBtn.disabled = false;
        els.bookBtn.textContent = 'Send appointment request';
      });
  });

  const tomorrow = addDays(new Date(), 1);
  state.anchor = tomorrow;
  state.selected = dateKey(tomorrow);
  els.bookingDate.min = dateKey(new Date());
  els.bookingDate.value = state.selected;

  loadTenant();
  renderScheduler().catch((err) => {
    setFeedback(err.message || 'We could not confirm availability right now.', 'bad');
    els.bookBtn.disabled = true;
  });
})();
