// Sales-side helpers extracted from operator.js so quote/invoice tools load
// only when the office opens those surfaces.
(function attachOperatorSalesSidecars(global) {
  let bindingsReady = false;

  function runtime() {
    return global.PROOFLINK_OPERATOR_RUNTIME || {};
  }

  function currentOperator() {
    return runtime().getCurrentOperator?.() || null;
  }

  function quotesCache() {
    return runtime().getQuotesCache?.() || [];
  }

  function setQuotesCache(next) {
    runtime().setQuotesCache?.(next || []);
  }

  function fetching() {
    return runtime().getFetchingSet?.() || new Set();
  }

  function tabsLoaded() {
    return runtime().getTabsLoaded?.() || new Set();
  }

  function tabAbortSignal() {
    return runtime().getTabAbortSignal?.() || undefined;
  }

  function appendJob(jobRow) {
    runtime().appendJob?.(jobRow);
  }

  function setActiveJobId(value) {
    runtime().setActiveJobId?.(value || '');
  }

  function exportReviewsCsv() {
    const rows = global.REVIEWS_CACHE || [];
    if (!rows.length) {
      global.notifyOperator('There are no reviews to export yet.');
      return;
    }
    const headers = ['id', 'customer_name', 'customer_email', 'rating', 'comment', 'order_id', 'created_at'];
    global.downloadCsv('reviews', headers, rows.map((row) => headers.map((key) => row[key] ?? '')));
  }

  async function generateInvoicePDF(order) {
    let jsPDF;
    try {
      jsPDF = await global.ensureJsPdfLoaded();
    } catch (err) {
      global.notifyOperator(err.message || 'The PDF tool is not available right now.');
      return;
    }

    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const width = doc.internal.pageSize.getWidth();
    const red = [200, 75, 47];
    const dark = [26, 26, 26];
    const grey = [100, 100, 100];
    const fmt = (value) => (Number.isNaN(Number(value)) ? '-' : `$${Number(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`);
    const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    doc.setFillColor(...red);
    doc.rect(0, 0, width, 48, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(255, 255, 255);
    doc.text('INVOICE', 40, 31);

    const bizName = (currentOperator()?.business_name || currentOperator()?.name || 'ProofLink Business').slice(0, 50);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(bizName, width - 40, 28, { align: 'right' });

    doc.setTextColor(...dark);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Invoice #', 40, 80);
    doc.text('Date', 40, 96);
    doc.text('Status', 40, 112);

    doc.setFont('helvetica', 'normal');
    doc.text(String(order.id || '').slice(0, 8).toUpperCase(), 140, 80);
    doc.text(now, 140, 96);
    doc.text(String(order.status || 'new').toUpperCase(), 140, 112);

    doc.setFont('helvetica', 'bold');
    doc.text('Bill To', width - 200, 80);
    doc.setFont('helvetica', 'normal');
    doc.text(String(order.customer_name || '-'), width - 200, 96);
    if (order.customer_email) doc.text(order.customer_email, width - 200, 112);

    doc.setDrawColor(220, 220, 210);
    doc.line(40, 130, width - 40, 130);

    let y = 152;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...dark);
    doc.text(String(order.title || 'Service'), 40, y);
    y += 18;

    if (order.description) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(...grey);
      const lines = doc.splitTextToSize(String(order.description), width - 80);
      lines.slice(0, 6).forEach((line) => {
        doc.text(line, 40, y);
        y += 13;
      });
      y += 6;
    }

    y += 10;
    doc.setFillColor(244, 241, 236);
    doc.rect(40, y - 13, width - 80, 18, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...dark);
    doc.text('Description', 48, y);
    doc.text('Qty', width - 200, y, { align: 'right' });
    doc.text('Unit Price', width - 130, y, { align: 'right' });
    doc.text('Amount', width - 40, y, { align: 'right' });
    y += 18;

    const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
    doc.setFont('helvetica', 'normal');
    if (!lineItems.length) {
      doc.text(String(order.title || 'Service'), 48, y);
      doc.text('1', width - 200, y, { align: 'right' });
      doc.text(fmt(order.total_amount || 0), width - 130, y, { align: 'right' });
      doc.text(fmt(order.total_amount || 0), width - 40, y, { align: 'right' });
      y += 16;
    } else {
      lineItems.forEach((item) => {
        const qty = Number(item.quantity || 1);
        const price = Number(item.unit_price || item.price || 0);
        doc.text(String(item.name || item.description || 'Item').slice(0, 48), 48, y);
        doc.text(String(qty), width - 200, y, { align: 'right' });
        doc.text(fmt(price), width - 130, y, { align: 'right' });
        doc.text(fmt(qty * price), width - 40, y, { align: 'right' });
        y += 16;
      });
    }

    y += 8;
    doc.setDrawColor(220, 220, 210);
    doc.line(width - 220, y, width - 40, y);
    y += 16;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Total Due', width - 220, y);
    doc.setTextColor(...red);
    doc.text(fmt(order.total_amount || 0), width - 40, y, { align: 'right' });

    doc.setTextColor(...grey);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Generated by ProofLink · prooflink.co', width / 2, doc.internal.pageSize.getHeight() - 24, { align: 'center' });

    const filename = `invoice-${String(order.id || 'order').slice(0, 8)}-${now.replace(/\s/g, '-')}.pdf`;
    doc.save(filename);
  }

  async function fetchQuotes(status) {
    const pending = fetching();
    if (pending.has('quotes')) return;
    pending.add('quotes');
    try {
      const tok = await runtime().getAccessToken?.();
      const url = status
        ? `/.netlify/functions/get-quotes?status=${encodeURIComponent(status)}`
        : '/.netlify/functions/get-quotes';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${tok}` },
        signal: tabAbortSignal(),
      });
      const payload = await res.json().catch(() => ({}));
      setQuotesCache(payload.quotes || []);
      tabsLoaded().delete('quotes');
      return quotesCache();
    } catch (err) {
      if (err.name === 'AbortError' || err.message?.includes('abort')) return;
      console.warn('[quotes] fetch failed:', err.message);
      return [];
    } finally {
      pending.delete('quotes');
    }
  }

  function renderQuotesList() {
    const el = global.$?.('quotesList');
    if (!el) return;

    const statusFilter = global.$?.('quotesStatusFilter')?.value || '';
    const rows = statusFilter ? quotesCache().filter((quote) => quote.status === statusFilter) : quotesCache();
    if (!rows.length) {
      el.innerHTML = '<div class="muted">No quotes sent yet. Build and send your first estimate using the <strong>Walkthrough Bids</strong> tab, then it will appear here once delivered to the customer.</div>';
      return;
    }

    const statusColor = {
      pending: '#93c5fd',
      accepted: '#4ade80',
      declined: '#f87171',
      expired: 'rgba(255,255,255,.35)',
    };
    const fmtMoney = (cents) => (cents != null && cents !== '' ? `$${(Number(cents) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}` : '$0.00');
    const convertibleStatuses = ['pending', 'accepted', 'approved'];
    const now = new Date();

    const toExpire = rows.filter((quote) => quote.status === 'pending' && quote.valid_until && new Date(quote.valid_until) < now);
    if (toExpire.length) {
      const expireIds = toExpire.map((quote) => quote.id);
      runtime().getSupabase?.()
        .from('quotes')
        .update({ status: 'expired', updated_at: new Date().toISOString() })
        .in('id', expireIds)
        .eq(runtime().getTenantColumn?.(), runtime().getTenantId?.())
        .then(() => {
          setQuotesCache(quotesCache().map((quote) => (expireIds.includes(quote.id) ? { ...quote, status: 'expired' } : quote)));
        })
        .catch((err) => console.warn('[quotes] auto-expire update failed:', err.message));
    }

    el.innerHTML = `
      <div class="list">
        ${rows.map((quote) => {
          const isExpired = quote.status === 'expired' || (quote.status === 'pending' && quote.valid_until && new Date(quote.valid_until) < now);
          const displayStatus = isExpired && quote.status === 'pending' ? 'expired' : quote.status;
          const color = statusColor[displayStatus] || 'rgba(255,255,255,.5)';
          const quoteUrl = `${location.origin}/quote.html?id=${encodeURIComponent(quote.id)}`;
          const isPending = quote.status === 'pending' && !isExpired;
          const canConvert = !isExpired && convertibleStatuses.includes(String(quote.status || '').toLowerCase());
          return `
            <div class="list-item" style="flex-direction:column;align-items:flex-start;gap:6px;">
              <div style="display:flex;align-items:center;gap:10px;width:100%;">
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:600;font-size:.9rem;">${global.escapeHtml(quote.title || 'Quote')}</div>
                  <div class="muted" style="font-size:.78rem;">${global.escapeHtml(quote.customer_name || '')}${quote.customer_email ? ` · ${global.escapeHtml(quote.customer_email)}` : ''} · ${global.formatDateOnly(quote.created_at)}</div>
                </div>
                <span style="font-size:.75rem;padding:3px 9px;background:rgba(255,255,255,.06);border-radius:12px;color:${color};white-space:nowrap;">${global.escapeHtml(displayStatus || 'pending')}</span>
                <span style="font-size:.85rem;font-weight:700;color:var(--text);white-space:nowrap;">${fmtMoney(quote.amount_cents)}</span>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <a href="${global.escapeHtml(quoteUrl)}" target="_blank" style="font-size:.78rem;color:var(--accent);text-decoration:none;">View quote page →</a>
                ${isPending ? `<button class="btn btn-ghost btn-sm qt-resend-btn" data-email="${global.escapeHtml(quote.customer_email || '')}" data-url="${global.escapeHtml(quoteUrl)}" data-name="${global.escapeHtml(quote.customer_name || '')}" type="button" style="font-size:.75rem;padding:2px 8px;">Copy link</button>` : ''}
                ${canConvert ? `<button class="btn btn-ghost btn-sm qt-convert-job-btn" data-quote-id="${global.escapeAttr(quote.id)}" data-customer-id="${global.escapeAttr(quote.customer_id || '')}" data-title="${global.escapeAttr(quote.title || '')}" data-notes="${global.escapeAttr(quote.description || quote.notes || '')}" data-order-id="${global.escapeAttr(quote.order_id || '')}" type="button" style="font-size:.75rem;padding:2px 8px;color:#fbbf24;border-color:rgba(251,191,36,.3);">Convert to Job →</button>` : ''}
                ${quote.accepted_at ? `<span class="muted" style="font-size:.75rem;">Accepted ${global.formatDateOnly(quote.accepted_at)}</span>` : ''}
                ${quote.declined_at ? `<span class="muted" style="font-size:.75rem;">Declined ${global.formatDateOnly(quote.declined_at)}</span>` : ''}
                ${quote.valid_until ? `<span class="muted" style="font-size:.75rem;">${isExpired ? 'Expired' : 'Valid until'} ${global.formatDateOnly(quote.valid_until)}</span>` : ''}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    el.querySelectorAll('.qt-resend-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const url = button.dataset.url;
        const name = button.dataset.name;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(() => {
            button.textContent = 'Copied!';
            setTimeout(() => {
              button.textContent = 'Copy link';
            }, 2000);
          });
        } else {
          global.showCopyModal(`Copy this link and send it to ${name || 'the customer'}.`, url).catch(() => {});
        }
      });
    });

    el.querySelectorAll('.qt-convert-job-btn').forEach((button) => {
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        button.textContent = 'Creating job...';
        try {
          const orderId = button.dataset.orderId || null;
          if (orderId) {
            const linkedOrder = (runtime().getOrdersCache?.() || []).find((row) => row.id === orderId);
            if (linkedOrder) global.assertOrderAllowsJobCreation(linkedOrder);
          }
          const nowIso = new Date().toISOString();
          const customerId = button.dataset.customerId || null;
          const payload = global.withTenantScope({
            operator_id: runtime().getOperatorId?.(),
            customer_id: customerId || null,
            order_id: orderId || null,
            status: 'new',
            title: button.dataset.title || 'Job from quote',
            notes: button.dataset.notes || '',
            updated_at: nowIso,
          });
          const { data: jobRow, error: jobErr } = await runtime().getSupabase?.()
            .from('jobs')
            .insert({ ...payload, created_at: nowIso })
            .select('*')
            .single();
          if (jobErr) throw jobErr;
          appendJob(jobRow);
          setActiveJobId(jobRow.id);
          global.showToast('Job created from quote. View it in Active Jobs.', 5000, 'ok');
          global.switchTab('jobs');
        } catch (err) {
          global.showToast(`Could not create job: ${err.message || String(err)}`, 4000);
          button.disabled = false;
          button.textContent = 'Convert to Job →';
        }
      });
    });
  }

  async function fetchAndRenderQuotes() {
    await fetchQuotes(global.$?.('quotesStatusFilter')?.value || '');
    renderQuotesList();
  }

  function exportQuotesCsv() {
    if (!quotesCache().length) {
      global.notifyOperator('There are no quotes to export yet.');
      return;
    }
    const headers = ['id', 'title', 'customer_name', 'customer_email', 'amount_cents', 'status', 'valid_until', 'created_at', 'accepted_at', 'declined_at'];
    global.downloadCsv('quotes', headers, quotesCache().map((quote) => headers.map((key) => quote[key] ?? '')));
  }

  function bindUi() {
    if (bindingsReady) return;
    bindingsReady = true;

    global.$?.('btnRefreshQuotes')?.addEventListener('click', () => {
      fetchAndRenderQuotes().catch(console.error);
    });
    global.$?.('quotesStatusFilter')?.addEventListener('change', () => {
      renderQuotesList();
    });
    global.$?.('btnExportQuotesCsv')?.addEventListener('click', exportQuotesCsv);
    global.$?.('btnExportReviewsCsv')?.addEventListener('click', exportReviewsCsv);
  }

  bindUi();

  global.PROOFLINK_OPERATOR_SALES_SIDECARS = {
    exportQuotesCsv,
    exportReviewsCsv,
    fetchQuotes,
    fetchAndRenderQuotes,
    generateInvoicePDF,
    renderQuotesList,
  };

  Object.assign(global, {
    exportQuotesCsv,
    exportReviewsCsv,
    fetchAndRenderQuotes,
    fetchQuotes,
    generateInvoicePDF,
    renderQuotesList,
  });
})(window);
