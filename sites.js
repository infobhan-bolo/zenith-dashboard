let sortKey = 'randomized';
let sortDirection = 'desc';
let currentPayload = null;
let currentCountry = '';
let historyRows = [];

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function eCVDText(value) {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function deriveSfrPercent(screened, screening, failed) {
  const denominator = (screened || 0) - (screening || 0);
  if (denominator <= 0) return null;
  return Math.round(((failed || 0) / denominator) * 100);
}

function percentText(value) {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function averageDailyNewRandomized(series, windowSize) {
  if (!series || series.length < 2) return null;
  const deltas = [];
  for (let i = 1; i < series.length; i += 1) {
    const curr = series[i] ?? 0;
    const prev = series[i - 1] ?? 0;
    deltas.push(curr - prev);
  }
  if (!deltas.length) return null;
  const window = deltas.slice(-Math.min(windowSize, deltas.length));
  return window.reduce((sum, value) => sum + value, 0) / window.length;
}

function countryRandomizedSeries(country) {
  return historyRows
    .map((snapshot) => (snapshot.countries || []).find((row) => row.country === country)?.randomized)
    .filter((value) => value !== null && value !== undefined);
}

function formatAverageSummary(value) {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)}/day`;
}

function formatSubstatValue(value) {
  if (value === null || value === undefined) return '—';
  return `${value}`;
}

function summaryCard(label, value, badge = null, badgeLabel = 'eCVD') {
  return `
    <div class="summary-card summary-card-trend">
      <div class="summary-card-corner ${badge === null || badge === undefined ? 'hidden' : ''}">${badge === null || badge === undefined ? '' : `${badge}% ${badgeLabel}`}</div>
      <div class="summary-label summary-label-full">${label}</div>
      <div class="summary-row">
        <div class="summary-main">
          <div class="summary-value">${value}</div>
        </div>
      </div>
    </div>
  `;
}

function renderSummaryMetricsCard(country, totals) {
  const series = countryRandomizedSeries(country);
  const avg7 = averageDailyNewRandomized(series, 7);
  const avg30 = averageDailyNewRandomized(series, 30);
  const ecvd = totals.ecvd_randomized_total ? totals.ecvd_randomized_yes : null;
  const hrcvd = totals.ecvd_randomized_total ? Math.max(totals.ecvd_randomized_total - totals.ecvd_randomized_yes, 0) : null;
  return `
    <div class="summary-card summary-metrics-card">
      <div class="summary-metrics">
        <div class="summary-metric">
          <div class="summary-label">7D Rand/Day</div>
          <div class="summary-metric-value">${formatAverageSummary(avg7)}</div>
        </div>
        <div class="summary-metric">
          <div class="summary-label">30D Rand/Day</div>
          <div class="summary-metric-value">${formatAverageSummary(avg30)}</div>
        </div>
        <div class="summary-metric">
          <div class="summary-label">eCVD Randomized</div>
          <div class="summary-metric-value">${formatSubstatValue(ecvd)}</div>
        </div>
        <div class="summary-metric">
          <div class="summary-label">HRCVD Randomized</div>
          <div class="summary-metric-value">${formatSubstatValue(hrcvd)}</div>
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

function setCrossLinks(country) {
  const historyLink = document.getElementById('history-link');
  if (!historyLink) return;
  historyLink.href = country
    ? `./history.html?country=${encodeURIComponent(country)}`
    : './history.html';
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
  const sfrPct = deriveSfrPercent(totals.screened, totals.screening, totals.failed);

  document.getElementById('site-summary-grid').innerHTML = [
    summaryCard('Screened', totals.screened),
    summaryCard('Randomized', totals.randomized, randPct),
    summaryCard('In Screening', totals.screening, screenPct),
    summaryCard('Screen Failed', totals.failed, sfrPct, 'SFR'),
    summaryCard('End of Treatment', totals.eot),
  ].join('') + renderSummaryMetricsCard(country, totals);

  document.getElementById('site-table-title').textContent = country ? `${country} Site Totals` : 'Site Totals';
  const randomizedSites = rows.filter((row) => (row.randomized || 0) > 0).length;
  const randomizedSitesPct = rows.length ? Math.round((randomizedSites / rows.length) * 100) : 0;
  document.getElementById('site-table-subtitle').textContent =
    `${rows.length} total sites · ${randomizedSites} sites with randomized patients (${randomizedSitesPct}%)`;
}

function sortedRows(rows) {
  return [...rows].sort((a, b) => {
    const av = sortKey === 'sfr' ? deriveSfrPercent(a.screened, a.screening, a.failed) : a[sortKey];
    const bv = sortKey === 'sfr' ? deriveSfrPercent(b.screened, b.screening, b.failed) : b[sortKey];
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
    body.innerHTML = '<tr><td colspan="9" class="muted">No site totals available for this country.</td></tr>';
    updateSortIndicators();
    return;
  }
  body.innerHTML = sortedRows(rows).map(row => {
    const sfrPct = deriveSfrPercent(row.screened, row.screening, row.failed);
    return `
      <tr>
        <td>${esc(row.site)}</td>
        <td class="number">${row.screened}</td>
        <td class="number">${row.randomized}</td>
        <td class="number ecvd-cell ${row.ecvd_randomized_percent === null || row.ecvd_randomized_percent === undefined ? 'blank' : ''}">${eCVDText(row.ecvd_randomized_percent)}</td>
        <td class="number">${row.screening}</td>
        <td class="number ecvd-cell ${row.ecvd_screening_percent === null || row.ecvd_screening_percent === undefined ? 'blank' : ''}">${eCVDText(row.ecvd_screening_percent)}</td>
        <td class="number">${row.failed}</td>
        <td class="number">${percentText(sfrPct)}</td>
        <td class="number">${row.eot}</td>
      </tr>
    `;
  }).join('');
  updateSortIndicators();
}

function renderView(payload, country) {
  const rows = (payload.sites || []).filter(row => row.country === country)
    .sort((a, b) => (b.randomized - a.randomized) || a.site.localeCompare(b.site));
  setCrossLinks(country);
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
    const ts = Date.now();
    const [dataRes, historyRes] = await Promise.all([
      fetch(`./data.json?ts=${ts}`, { cache: 'no-store' }),
      fetch(`./history_index.json?ts=${ts}`, { cache: 'no-store' }),
    ]);
    if (!dataRes.ok) throw new Error(`HTTP ${dataRes.status}`);
    const payload = await dataRes.json();
    historyRows = historyRes.ok ? await historyRes.json() : [];
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
    document.getElementById('site-body').innerHTML = `<tr><td colspan="9" class="muted">${esc(String(err))}</td></tr>`;
  }
}

setupSorting();
loadSites();
