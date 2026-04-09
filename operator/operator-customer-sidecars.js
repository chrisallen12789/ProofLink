// Customer-side helpers extracted from operator.js so CSV export/import work
// only load when the customer workspace is active.
(function attachOperatorCustomerSidecars(global) {
  let bindingsReady = false;

  function bindUi() {
    if (bindingsReady) return;
    bindingsReady = true;

    global.$?.('btnExportCustomersCsv')?.addEventListener('click', () => {
      const rows = [['Name', 'Email', 'Phone', 'City', 'State', 'Created']];
      (global.CUSTOMERS_CACHE || []).forEach((row) => {
        rows.push([row.name || '', row.email || '', row.phone || '', row.city || '', row.state || '', (row.created_at || '').slice(0, 10)]);
      });
      const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
      const anchor = document.createElement('a');
      anchor.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
      anchor.download = 'customers.csv';
      anchor.click();
    });

    global.$?.('btnImportCustomers')?.addEventListener('click', () => {
      const existing = document.getElementById('importCustomersModal');
      if (existing) {
        existing.remove();
        return;
      }

      const modal = document.createElement('div');
      modal.id = 'importCustomersModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';
      modal.innerHTML = `
        <div style="background:#1a1d27;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:28px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <strong style="font-size:1rem;">Import customers from CSV</strong>
            <button id="importCustClose" type="button" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:1.2rem;cursor:pointer;">×</button>
          </div>
          <div style="font-size:.78rem;color:rgba(255,255,255,.4);margin-bottom:10px;">Expected format (one per line):<br /><code style="font-size:.75rem;">Name, Email, Phone, Address, City, State, Zip</code></div>
          <textarea id="importCsvData" class="input" rows="8" style="width:100%;font-family:monospace;font-size:.8rem;resize:vertical;" placeholder="Jane Smith, jane@example.com, 555-1234, 123 Main St, Springfield, IL, 62701&#10;John Doe, john@example.com, 555-9999"></textarea>
          <div style="margin-top:10px;display:flex;gap:8px;">
            <button id="btnImportCsvPreview" class="btn btn-ghost btn-sm" type="button">Preview</button>
            <button id="btnImportCsvSubmit" class="btn btn-primary btn-sm" type="button" disabled>Import 0 customers</button>
            <button id="importCustCancel" class="btn btn-ghost btn-sm" type="button">Cancel</button>
          </div>
          <div id="importCsvPreviewWrap" style="margin-top:12px;"></div>
          <div id="importCsvMsg" style="font-size:.8rem;margin-top:8px;"></div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('#importCustClose').onclick = () => modal.remove();
      modal.querySelector('#importCustCancel').onclick = () => modal.remove();
      modal.addEventListener('click', (event) => {
        if (event.target === modal) modal.remove();
      });

      let parsedRows = [];
      const parseCsv = (raw) => raw.split('\n')
        .map((line) => line.split(',').map((cell) => cell.trim()))
        .filter((cols) => cols.length >= 1 && cols[0]);

      modal.querySelector('#btnImportCsvPreview').onclick = () => {
        const raw = modal.querySelector('#importCsvData').value.trim();
        if (!raw) {
          modal.querySelector('#importCsvMsg').textContent = 'Paste CSV data first.';
          return;
        }
        parsedRows = parseCsv(raw);
        const preview = parsedRows.slice(0, 5);
        modal.querySelector('#importCsvPreviewWrap').innerHTML = `
          <div style="font-size:.78rem;color:rgba(255,255,255,.4);margin-bottom:6px;">Preview (first ${preview.length} of ${parsedRows.length} rows):</div>
          <table style="width:100%;font-size:.78rem;border-collapse:collapse;">
            <thead><tr style="color:rgba(255,255,255,.35);">${['Name', 'Email', 'Phone', 'Address', 'City', 'State', 'Zip'].map((header) => `<th style="text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);">${header}</th>`).join('')}</tr></thead>
            <tbody>${preview.map((row) => `<tr>${row.slice(0, 7).map((cell) => `<td style="padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.05);">${global.escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>`;
        const submitButton = modal.querySelector('#btnImportCsvSubmit');
        submitButton.textContent = `Import ${parsedRows.length} customer${parsedRows.length === 1 ? '' : 's'}`;
        submitButton.disabled = false;
        modal.querySelector('#importCsvMsg').textContent = '';
      };

      modal.querySelector('#btnImportCsvSubmit').onclick = async () => {
        const submitButton = modal.querySelector('#btnImportCsvSubmit');
        const messageEl = modal.querySelector('#importCsvMsg');
        if (!parsedRows.length) {
          messageEl.textContent = 'No rows to import.';
          return;
        }
        submitButton.disabled = true;
        submitButton.textContent = 'Importing...';
        try {
          const tok = await global.PROOFLINK_OPERATOR_RUNTIME?.getAccessToken?.();
          const customers = parsedRows.map(([name, email, phone, address, city, state, zip]) => ({
            name: name || '',
            email: email || undefined,
            phone: phone || undefined,
            address: address || undefined,
            city: city || undefined,
            state: state || undefined,
            zip: zip || undefined,
          }));
          const res = await fetch('/.netlify/functions/bulk-import-customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
            body: JSON.stringify({ customers }),
          });
          const payload = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(payload.error || 'Import failed');
          const imported = payload.imported || 0;
          const skipped = payload.skipped || 0;
          messageEl.textContent = `Imported ${imported}, Skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}`;
          messageEl.style.color = '#4ade80';
          await global.fetchCustomers();
          global.renderCustomersList(global.$?.('customerSearch')?.value || '');
          submitButton.textContent = 'Done';
          setTimeout(() => modal.remove(), 2500);
        } catch (err) {
          messageEl.textContent = err.message || 'Import failed.';
          messageEl.style.color = '#f87171';
          submitButton.disabled = false;
          submitButton.textContent = `Import ${parsedRows.length} customers`;
        }
      };
    });
  }

  bindUi();
  global.PROOFLINK_OPERATOR_CUSTOMER_SIDECARS = { bindUi };
})(window);
