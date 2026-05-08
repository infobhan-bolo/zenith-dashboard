let sortKey = 'randomized';
let sortDirection = 'desc';
let payload = { totals: {}, countries: [] };
let historyRows = [];

function derivePercent(bucket) {
  if (bucket === null || bucket === undefined) return null;
  if (typeof bucket === 'number') return bucket;
  if (typeof bucket.percent === 'number') return bucket.percent;
  const yes = bucket.yes ?? bucket.count ?? null;
  const total = bucket.total ?? null;
  if (yes === null || total === null || total === 0) return null;
  return Math.round((yes / total) * 100);
}

function latestHistorySnapshot() {
  return historyRows.length ? historyRows[historyRows.length - 1] : null;
}

function fallbackOverallEcvdPercent(label) {
  const latest = latestHistorySnapshot();
  if (!latest) return null;
  return label === 'Randomized'
    ? derivePercent(latest.established_cvd?.['Randomized'])
    : label === 'In Screening'
      ? derivePercent(latest.established_cvd?.['In Screening'])
      : null;
}

function fallbackCountryEcvdPercent(country, kind) {
  const latest = latestHistorySnapshot();
  if (!latest) return null;
  const row = (latest.countries || []).find(r => r.country === country);
  if (!row) return null;
  return kind === 'randomized'
    ? (row.ecvd_randomized_percent ?? null)
    : (row.ecvd_screening_percent ?? null);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function deltaText(curr, prev) {
  if (prev === null || prev === undefined) return '—';
  const d = curr - prev;
  if (d === 0) return 'Δ 0';
  return d > 0 ? `Δ +${d}` : `Δ ${d}`;
}

function sparklinePath(values, width = 220, height = 56) {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  return values.map((v, i) => {
    const x = values.length === 1 ? width / 2 : (i * (width - 4)) / (values.length - 1) + 2;
    const y = height - 2 - ((v - min) / span) * (height - 8);
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

function renderSummary() {
  const latestStored = historyRows.length ? historyRows[historyRows.length - 1] : null;
  const previousStored = historyRows.length > 1 ? historyRows[historyRows.length - 2] : null;
  const ordered = [
    { label: 'Screened', value: payload.totals['Screened'] || 0 },
    { label: 'Randomized', value: payload.totals['Randomized'] || 0 },
    { label: 'In Screening', value: payload.totals['In Screening'] || 0 },
    { label: 'Screen Failed', value: payload.totals['Screen Failed'] || 0 },
    { label: 'End of Treatment', value: payload.totals['End of Treatment'] || 0 },
  ];
  const grid = document.getElementById('summary-grid');
  grid.innerHTML = ordered.map(item => {
    const baseline = previousStored ? previousStored.totals[item.label] : latestStored ? latestStored.totals[item.label] : null;
    const delta = deltaText(item.value, baseline);
    const deltaClass = baseline !== null && baseline !== undefined && item.value < baseline ? 'delta down' : 'delta';
    const series = historyRows.map(r => r.totals[item.label] || 0);
    const cvd = payload.established_cvd || {};
    let cvdPercent = item.label === 'Randomized'
      ? derivePercent(cvd['Randomized'])
      : item.label === 'In Screening'
        ? derivePercent(cvd['In Screening'])
        : null;
    if ((cvdPercent === null || cvdPercent === 0) && (item.label === 'Randomized' || item.label === 'In Screening')) {
      cvdPercent = fallbackOverallEcvdPercent(item.label);
    }
    if (!series.length) series.push(item.value);
    const path = sparklinePath(series);
    return `
      <div class="summary-card summary-card-trend">
        <div class="summary-card-corner ${cvdPercent === null || cvdPercent === undefined ? 'hidden' : ''}">${cvdPercent === null || cvdPercent === undefined ? '' : `${cvdPercent}% eCVD`}</div>
        <div class="summary-label summary-label-full">${item.label}</div>
        <div class="summary-row">
          <div class="summary-main">
            <div class="summary-value">${item.value}</div>
            <div class="${deltaClass}">${delta}</div>
          </div>
          <svg viewBox="0 0 220 56" class="sparkline sparkline-side" preserveAspectRatio="none">
            <path d="${path}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </div>
      </div>
    `;
  }).join('');
}

function previousCountryMap() {
  const previousStored = historyRows.length > 1 ? historyRows[historyRows.length - 2] : historyRows.length ? historyRows[historyRows.length - 1] : null;
  const map = new Map();
  for (const row of (previousStored?.countries || [])) {
    map.set(row.country, row);
  }
  return map;
}

function sortedCountries() {
  const rows = [...(payload.countries || [])];
  rows.sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    let cmp = 0;
    if (typeof av === 'string' || typeof bv === 'string') {
      cmp = String(av).localeCompare(String(bv));
    } else {
      cmp = av - bv;
    }
    if (cmp === 0) cmp = a.country.localeCompare(b.country);
    return sortDirection === 'asc' ? cmp : -cmp;
  });
  return rows;
}

function updateSortIndicators() {
  document.querySelectorAll('.sort-btn').forEach((btn) => {
    const span = btn.querySelector('.sort-indicator');
    if (!span) return;
    span.textContent = btn.dataset.key === sortKey ? (sortDirection === 'asc' ? '↑' : '↓') : '';
  });
}

function countryDeltaCell(curr, prev) {
  if (prev === null || prev === undefined) return '<td class="number delta-cell blank"></td>';
  const d = curr - prev;
  if (d === 0) return '<td class="number delta-cell blank"></td>';
  const cls = d < 0 ? 'number delta-cell down' : 'number delta-cell';
  const text = d > 0 ? `+${d}` : `${d}`;
  return `<td class="${cls}">${text}</td>`;
}

function ecvdCell(value, fallbackValue = null) {
  const display = (value === null || value === undefined || value === 0) ? fallbackValue : value;
  if (display === null || display === undefined) return '<td class="number ecvd-cell blank"></td>';
  return `<td class="number ecvd-cell">${display}%</td>`;
}

function renderTable() {
  const body = document.getElementById('country-body');
  const prevMap = previousCountryMap();
  body.innerHTML = sortedCountries().map(row => {
    const prev = prevMap.get(row.country) || {};
    return `
      <tr>
        <td>
          <div class="country-link-wrap">
            <span class="country-link-label">${esc(row.country)}</span>
            <span class="country-link-actions">
              <a class="country-icon-link" href="./history.html?country=${encodeURIComponent(row.country)}" title="View history for ${esc(row.country)}" aria-label="View history for ${esc(row.country)}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"></path><path d="m19 9-5 5-4-4-3 3"></path></svg>
              </a>
              <a class="country-icon-link" href="./sites.html?country=${encodeURIComponent(row.country)}" title="View sites for ${esc(row.country)}" aria-label="View sites for ${esc(row.country)}">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M7 8h10"></path><path d="M7 12h4"></path><path d="M7 16h7"></path></svg>
              </a>
            </span>
          </div>
        </td>
        <td class="number">${row.screened}</td>
        ${countryDeltaCell(row.screened, prev.screened)}
        <td class="number">${row.randomized}</td>
        ${countryDeltaCell(row.randomized, prev.randomized)}
        ${ecvdCell(row.ecvd_randomized_percent, fallbackCountryEcvdPercent(row.country, 'randomized'))}
        <td class="number">${row.screening}</td>
        ${countryDeltaCell(row.screening, prev.screening)}
        ${ecvdCell(row.ecvd_screening_percent, fallbackCountryEcvdPercent(row.country, 'screening'))}
        <td class="number">${row.failed}</td>
        ${countryDeltaCell(row.failed, prev.failed)}
        <td class="number">${row.eot}</td>
        ${countryDeltaCell(row.eot, prev.eot)}
      </tr>
    `;
  }).join('');
  updateSortIndicators();
}

function setupSorting() {
  document.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (key === sortKey) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDirection = key === 'country' ? 'asc' : 'desc';
      }
      renderTable();
    });
  });
}

async function loadHistory() {
  try {
    const res = await fetch(`./history_index.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    historyRows = await res.json();
  } catch {
    historyRows = [];
  }
}

async function loadData() {
  const res = await fetch(`./data.json?ts=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  payload = await res.json();
  await loadHistory();
  document.getElementById('updated-at').textContent = `Snapshot loaded ${new Date(payload.updated_at).toLocaleString()}`;
  renderSummary();
  renderTable();
}

function setupRefreshLink() {
  document.getElementById('refresh-link')?.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      document.getElementById('updated-at').textContent = 'Refreshing…';
      await fetch('./__refresh__', { cache: 'no-store' }).catch(() => null);
      await new Promise(r => setTimeout(r, 1500));
      await loadData();
    } catch (err) {
      document.getElementById('updated-at').textContent = 'Refresh failed';
    }
  });
}

setupSorting();
setupRefreshLink();
loadData().catch(() => {
  document.getElementById('updated-at').textContent = 'Load failed';
});
