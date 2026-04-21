let sortKey = 'randomized';
let sortDirection = 'desc';
let currentPayload = null;
let currentCountry = '';

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function eCVDText(value) {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function summaryCard(label, value, badge = null) {
  return `
    <div class="summary-card summary-card-trend">
      <div class="summary-card-corner ${badge === null || badge === undefined ? 'hidden' : ''}">${badge === null || badge === undefined ? '' : `${badge}% eCVD`}</div>
      <div class="summary-label summary-label-full">${label}</div>
      <div class="summary-row">
        <div class="summary-main">
          <div class="summary-value">${value}</div>
        </div>
      </div>
    </div>
  `;
}

function countriesFromSites(sites) {
  return [...new Set((sites || []).map(s => s.country).filter(Boolean))].sort();
}

function initialCountry(countries) {
  const requested = new URLSearchParams(window.location.search).get('country');
  if (requested && countries.includes(requested)) return requested;
  return countries[0] || '';
}

function renderSelector(countries, selection) {
  const select = document.getElementById('site-country-select');
  select.innerHTML = countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  select.value = selection;
}

function renderSummary(rows, country) {
  const totals = rows.reduce((acc, row) => {
    acc.screened += row.screened || 0;
    acc.randomized += row.randomized || 0;
    acc.screening += row.screening || 0;
    acc.failed += row.failed || 0;
    acc.eot += row.eot || 0;
    acc.ecvd_randomized_yes += row.ecvd_randomized_yes || 0;
    acc.ecvd_randomized_total += row.ecvd_randomized_total || 0;
    acc.ecvd_screening_yes += row.ecvd_screening_yes || 0;
    acc.ecvd_screening_total += row.ecvd_screening_total || 0;
    return acc;
  }, {
    screened: 0, randomized: 0, screening: 0, failed: 0, eot: 0,
    ecvd_randomized_yes: 0, ecvd_randomized_total: 0,
    ecvd_screening_yes: 0, ecvd_screening_total: 0,
  });

  const randPct = totals.ecvd_randomized_total ? Math.round((totals.ecvd_randomized_yes / totals.ecvd_randomized_total) * 100) : null;
  const screenPct = totals.ecvd_screening_total ? Math.round((totals.ecvd_screening_yes / totals.ecvd_screening_total) * 100) : null;

  document.getElementById('site-summary-grid').innerHTML = [
    summaryCard('Screened', totals.screened),
    summaryCard('Randomized', totals.randomized, randPct),
    summaryCard('In Screening', totals.screening, screenPct),
    summaryCard('Screen Failed', totals.failed),
    summaryCard('End of Treatment', totals.eot),
  ].join('');

  document.getElementById('site-table-title').textContent = country ? `${country} Site Totals` : 'Site Totals';
}

function sortedRows(rows) {
  return [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    let cmp = 0;
    if (typeof av === 'string' || typeof bv === 'string') {
      cmp = String(av || '').localeCompare(String(bv || ''));
    } else {
      cmp = (av ?? -1) - (bv ?? -1);
    }
    if (cmp === 0) cmp = String(a.site || '').localeCompare(String(b.site || ''));
    return sortDirection === 'asc' ? cmp : -cmp;
  });
}

function updateSortIndicators() {
  document.querySelectorAll('.sort-btn').forEach((btn) => {
    const span = btn.querySelector('.sort-indicator');
    if (!span) return;
    span.textContent = btn.dataset.key === sortKey ? (sortDirection === 'asc' ? '↑' : '↓') : '';
  });
}

function renderTable(rows) {
  const body = document.getElementById('site-body');
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="8" class="muted">No site totals available for this country.</td></tr>';
    updateSortIndicators();
    return;
  }
  body.innerHTML = sortedRows(rows).map(row => `
    <tr>
      <td>${esc(row.site)}</td>
      <td class="number">${row.screened}</td>
      <td class="number">${row.randomized}</td>
      <td class="number ecvd-cell ${row.ecvd_randomized_percent === null || row.ecvd_randomized_percent === undefined ? 'blank' : ''}">${eCVDText(row.ecvd_randomized_percent)}</td>
      <td class="number">${row.screening}</td>
      <td class="number ecvd-cell ${row.ecvd_screening_percent === null || row.ecvd_screening_percent === undefined ? 'blank' : ''}">${eCVDText(row.ecvd_screening_percent)}</td>
      <td class="number">${row.failed}</td>
      <td class="number">${row.eot}</td>
    </tr>
  `).join('');
  updateSortIndicators();
}

function renderView(payload, country) {
  const rows = (payload.sites || []).filter(row => row.country === country)
    .sort((a, b) => (b.randomized - a.randomized) || a.site.localeCompare(b.site));
  renderSummary(rows, country);
  renderTable(rows);
}

function setupSorting() {
  document.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (key === sortKey) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDirection = key === 'site' ? 'asc' : 'desc';
      }
      if (currentPayload && currentCountry) renderView(currentPayload, currentCountry);
    });
  });
}

async function loadSites() {
  const updated = document.getElementById('sites-updated-at');
  try {
    const res = await fetch('./data.json?ts=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    updated.textContent = `Snapshot loaded ${new Date(payload.updated_at).toLocaleString()}`;
    currentPayload = payload;
    const countries = countriesFromSites(payload.sites || []);
    const selection = initialCountry(countries);
    currentCountry = selection;
    renderSelector(countries, selection);
    renderView(payload, selection);
    document.getElementById('site-country-select').onchange = (e) => {
      currentCountry = e.target.value;
      renderView(payload, e.target.value);
    };
  } catch (err) {
    updated.textContent = 'Site totals load failed';
    document.getElementById('site-body').innerHTML = `<tr><td colspan="8" class="muted">${esc(String(err))}</td></tr>`;
  }
}

setupSorting();
loadSites();
