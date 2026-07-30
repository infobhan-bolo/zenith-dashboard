let sortKey = 'randomized';
let sortDirection = 'desc';
let showTooltipMetrics = false;
let payload = { totals: {}, countries: [] };
let historyRows = [];
const hiddenMetricSortKeys = ['avg7_randomized', 'avg30_randomized', 'ecvd_randomized_yes', 'hrcvd_randomized'];

function derivePercent(bucket) {
  if (bucket === null || bucket === undefined) return null;
  if (typeof bucket === 'number') return bucket;
  if (typeof bucket.percent === 'number') return bucket.percent;
  const yes = bucket.yes ?? bucket.count ?? null;
  const total = bucket.total ?? null;
  if (yes === null || total === null || total === 0) return null;
  return Math.round((yes / total) * 100);
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

function randomizedPatientMixLines(ecvdYes, total) {
  if (ecvdYes === null || ecvdYes === undefined || total === null || total === undefined) return [];
  const hrcvd = total - ecvdYes;
  return [
    `eCVD: ${ecvdYes}`,
    `hrCVD: ${hrcvd < 0 ? '—' : hrcvd}`,
  ];
}

function averageTooltipText(series, scopeLabel, randomizedMix = {}) {
  const avg7 = averageDailyNewRandomized(series, 7);
  const avg30 = averageDailyNewRandomized(series, 30);
  const lines = [
    `${scopeLabel} new randomized patients/day averages`,
    `7-day: ${avg7 === null ? '—' : avg7.toFixed(1)}/day`,
    `30-day: ${avg30 === null ? '—' : avg30.toFixed(1)}/day`,
    ...randomizedPatientMixLines(randomizedMix.ecvdYes, randomizedMix.total),
  ];
  return lines.join('\n');
}

function overallRandomizedSeries() {
  return historyRows.map((row) => row.totals?.['Randomized'] || 0);
}

function randomizedMixCounts(bucket) {
  const total = bucket?.total;
  const ecvd = bucket?.yes;
  if (total === null || total === undefined || ecvd === null || ecvd === undefined) {
    return { ecvd: null, hrcvd: null };
  }
  return {
    ecvd,
    hrcvd: Math.max(total - ecvd, 0),
  };
}

function countryRandomizedSeries(country) {
  return historyRows
    .map((snapshot) => (snapshot.countries || []).find((row) => row.country === country)?.randomized)
    .filter((value) => value !== null && value !== undefined);
}

function countryAverageMetrics(country) {
  const series = countryRandomizedSeries(country);
  return {
    avg7: averageDailyNewRandomized(series, 7),
    avg30: averageDailyNewRandomized(series, 30),
  };
}

function formatAverageCell(value) {
  if (value === null || value === undefined) return '—';
  return value.toFixed(1);
}

function formatAverageSummary(value) {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)}/day`;
}

function formatSubstatValue(value, suffix = '') {
  if (value === null || value === undefined) return '—';
  return `${value}${suffix}`;
}

function renderSummaryMetricsCard(randomizedBucket) {
  const avg7 = averageDailyNewRandomized(overallRandomizedSeries(), 7);
  const avg30 = averageDailyNewRandomized(overallRandomizedSeries(), 30);
  const mix = randomizedMixCounts(randomizedBucket);
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
          <div class="summary-metric-value">${formatSubstatValue(mix.ecvd)}</div>
        </div>
        <div class="summary-metric">
          <div class="summary-label">HRCVD Randomized</div>
          <div class="summary-metric-value">${formatSubstatValue(mix.hrcvd)}</div>
        </div>
      </div>
    </div>
  `;
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
  const randomizedBucket = payload.established_cvd?.['Randomized'];
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
    const cvdPercent = item.label === 'Randomized'
      ? derivePercent(cvd['Randomized'])
      : item.label === 'In Screening'
        ? derivePercent(cvd['In Screening'])
        : null;
    const tooltip = item.label === 'Randomized'
      ? averageTooltipText(overallRandomizedSeries(), 'Overall', {
          ecvdYes: cvd['Randomized']?.yes,
          total: cvd['Randomized']?.total,
        })
      : '';
    if (!series.length) series.push(item.value);
    const path = sparklinePath(series);
    return `
      <div class="summary-card summary-card-trend">
        <div class="summary-card-corner ${cvdPercent === null || cvdPercent === undefined ? 'hidden' : ''}">${cvdPercent === null || cvdPercent === undefined ? '' : `${cvdPercent}% eCVD`}</div>
        <div class="summary-label summary-label-full">${item.label}</div>
        <div class="summary-row">
          <div class="summary-main">
            <div class="summary-value"${tooltip ? ` title="${esc(tooltip)}"` : ''}>${item.value}</div>
            <div class="${deltaClass}">${delta}</div>
          </div>
          <svg viewBox="0 0 220 56" class="sparkline sparkline-side" preserveAspectRatio="none">
            <path d="${path}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </div>
      </div>
    `;
  }).join('') + renderSummaryMetricsCard(randomizedBucket);
}

function previousCountryMap() {
  const previousStored = historyRows.length > 1 ? historyRows[historyRows.length - 2] : historyRows.length ? historyRows[historyRows.length - 1] : null;
  const map = new Map();
  for (const row of (previousStored?.countries || [])) {
    map.set(row.country, row);
  }
  return map;
}

function hrcvdRandomizedCount(row) {
  if (row.ecvd_randomized_total === null || row.ecvd_randomized_total === undefined) return null;
  return Math.max((row.ecvd_randomized_total || 0) - (row.ecvd_randomized_yes || 0), 0);
}

function countrySortValue(row, key) {
  if (key === 'avg7_randomized' || key === 'avg30_randomized') {
    const averages = countryAverageMetrics(row.country);
    return key === 'avg7_randomized' ? averages.avg7 : averages.avg30;
  }
  if (key === 'hrcvd_randomized') return hrcvdRandomizedCount(row);
  return row[key];
}

function sortedCountries() {
  const rows = [...(payload.countries || [])];
  rows.sort((a, b) => {
    const av = countrySortValue(a, sortKey);
    const bv = countrySortValue(b, sortKey);
    const aMissing = av === null || av === undefined || Number.isNaN(av);
    const bMissing = bv === null || bv === undefined || Number.isNaN(bv);
    if (aMissing || bMissing) {
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      return a.country.localeCompare(b.country);
    }
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

function ecvdCell(value) {
  if (value === null || value === undefined) return '<td class="number ecvd-cell blank"></td>';
  return `<td class="number ecvd-cell">${value}%</td>`;
}

function renderCountryHeaders() {
  const headerRow = document.getElementById('country-header-row');
  if (!headerRow) return;
  headerRow.innerHTML = showTooltipMetrics
    ? `
      <th><button class="sort-btn" data-key="country">Country <span class="sort-indicator"></span></button></th>
      <th class="metric-col"><button class="sort-btn" data-key="screened"><span class="sort-indicator"></span> Screened</button></th>
      <th class="delta-col">Δ</th>
      <th class="metric-col"><button class="sort-btn" data-key="randomized"><span class="sort-indicator"></span> Randomized</button></th>
      <th class="delta-col">Δ</th>
      <th class="metric-col">eCVD %</th>
      <th class="metric-col"><button class="sort-btn" data-key="screening"><span class="sort-indicator"></span> In Screening</button></th>
      <th class="delta-col">Δ</th>
      <th class="metric-col">eCVD %</th>
      <th class="metric-col"><button class="sort-btn" data-key="avg7_randomized"><span class="sort-indicator"></span> 7d rand/day</button></th>
      <th class="metric-col"><button class="sort-btn" data-key="avg30_randomized"><span class="sort-indicator"></span> 30d rand/day</button></th>
      <th class="metric-col"><button class="sort-btn" data-key="ecvd_randomized_yes"><span class="sort-indicator"></span> eCVD rand</button></th>
      <th class="metric-col"><button class="sort-btn" data-key="hrcvd_randomized"><span class="sort-indicator"></span> hrCVD rand</button></th>
    `
    : `
      <th><button class="sort-btn" data-key="country">Country <span class="sort-indicator"></span></button></th>
      <th class="metric-col"><button class="sort-btn" data-key="screened"><span class="sort-indicator"></span> Screened</button></th>
      <th class="delta-col">Δ</th>
      <th class="metric-col"><button class="sort-btn" data-key="randomized"><span class="sort-indicator"></span> Randomized</button></th>
      <th class="delta-col">Δ</th>
      <th class="metric-col">eCVD %</th>
      <th class="metric-col"><button class="sort-btn" data-key="screening"><span class="sort-indicator"></span> In Screening</button></th>
      <th class="delta-col">Δ</th>
      <th class="metric-col">eCVD %</th>
      <th class="metric-col"><button class="sort-btn" data-key="failed"><span class="sort-indicator"></span> Screen Failed</button></th>
      <th class="delta-col">Δ</th>
      <th class="metric-col"><button class="sort-btn" data-key="eot"><span class="sort-indicator"></span> End of Treatment</button></th>
      <th class="delta-col">Δ</th>
    `;
  setupSorting();
  updateSortIndicators();
}

function renderTable() {
  const body = document.getElementById('country-body');
  const prevMap = previousCountryMap();
  body.innerHTML = sortedCountries().map(row => {
    const prev = prevMap.get(row.country) || {};
    const averages = countryAverageMetrics(row.country);
    const hrcvdRandomized = hrcvdRandomizedCount(row);
    const randomizedTooltip = averageTooltipText(countryRandomizedSeries(row.country), row.country, {
      ecvdYes: row.ecvd_randomized_yes,
      total: row.ecvd_randomized_total,
    });
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
        <td class="number"${randomizedTooltip ? ` title="${esc(randomizedTooltip)}"` : ''}>${row.randomized}</td>
        ${countryDeltaCell(row.randomized, prev.randomized)}
        ${ecvdCell(row.ecvd_randomized_percent)}
        <td class="number">${row.screening}</td>
        ${countryDeltaCell(row.screening, prev.screening)}
        ${ecvdCell(row.ecvd_screening_percent)}
        ${showTooltipMetrics
          ? `
            <td class="number">${formatAverageCell(averages.avg7)}</td>
            <td class="number">${formatAverageCell(averages.avg30)}</td>
            <td class="number">${formatSubstatValue(row.ecvd_randomized_yes)}</td>
            <td class="number">${formatSubstatValue(hrcvdRandomized)}</td>
          `
          : `
            <td class="number">${row.failed}</td>
            ${countryDeltaCell(row.failed, prev.failed)}
            <td class="number">${row.eot}</td>
            ${countryDeltaCell(row.eot, prev.eot)}
          `}
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

function setupMetricToggle() {
  const toggle = document.getElementById('tooltip-metrics-toggle');
  if (!toggle) return;
  toggle.addEventListener('change', () => {
    showTooltipMetrics = toggle.checked;
    if (showTooltipMetrics && (sortKey === 'failed' || sortKey === 'eot')) {
      sortKey = 'randomized';
      sortDirection = 'desc';
    }
    if (!showTooltipMetrics && hiddenMetricSortKeys.includes(sortKey)) {
      sortKey = 'randomized';
      sortDirection = 'desc';
    }
    renderCountryHeaders();
    renderSummary();
    renderTable();
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
setupMetricToggle();
setupRefreshLink();
loadData().catch(() => {
  document.getElementById('updated-at').textContent = 'Load failed';
});
