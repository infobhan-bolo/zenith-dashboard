let currentSitesPayload = null;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function deltaText(curr, prev) {
  if (prev === null || prev === undefined) return '—';
  const d = curr - prev;
  if (d === 0) return '0';
  return d > 0 ? `+${d}` : `${d}`;
}

function averageNewRandomizedText(series, windowSize) {
  if (!series || series.length < 2) return null;
  const deltas = [];
  for (let i = 1; i < series.length; i += 1) {
    const curr = series[i]?.randomized ?? 0;
    const prev = series[i - 1]?.randomized ?? 0;
    deltas.push(curr - prev);
  }
  if (!deltas.length) return null;
  const window = deltas.slice(-Math.min(windowSize, deltas.length));
  const average = window.reduce((sum, value) => sum + value, 0) / window.length;
  return `${average.toFixed(1)}/day`;
}

function randomizedAverageSubtitle(series) {
  const avg7 = averageNewRandomizedText(series, 7);
  const avg30 = averageNewRandomizedText(series, 30);
  if (!avg7 && !avg30) return 'New randomized patients per day averages unavailable';
  return `New randomized patients/day averages: 7-day ${avg7 || '—'} · 30-day ${avg30 || '—'}`;
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

function countrySeries(rows) {
  const map = new Map();
  for (const snapshot of rows) {
    for (const c of (snapshot.countries || [])) {
      if (!map.has(c.country)) map.set(c.country, []);
      map.get(c.country).push({
        date: snapshot.date,
        screened: c.screened,
        randomized: c.randomized,
        ecvd_randomized_percent: c.ecvd_randomized_percent,
        screening: c.screening,
        ecvd_screening_percent: c.ecvd_screening_percent,
        failed: c.failed,
        eot: c.eot,
      });
    }
  }
  return map;
}

function derivePercent(bucket) {
  if (bucket === null || bucket === undefined) return null;
  if (typeof bucket === 'number') return bucket;
  if (typeof bucket.percent === 'number') return bucket.percent;
  const yes = bucket.yes ?? bucket.count ?? null;
  const total = bucket.total ?? null;
  if (yes === null || total === null || total === 0) return null;
  return Math.round((yes / total) * 100);
}

function metricsForSelection(rows, selection) {
  if (selection === '__overall__') {
    return rows.map(r => ({
      date: r.date,
      screened: r.totals['Screened'] || 0,
      randomized: r.totals['Randomized'] || 0,
      ecvd_randomized_percent: derivePercent(r.established_cvd?.['Randomized']),
      screening: r.totals['In Screening'] || 0,
      ecvd_screening_percent: derivePercent(r.established_cvd?.['In Screening']),
      failed: r.totals['Screen Failed'] || 0,
      eot: r.totals['End of Treatment'] || 0,
    }));
  }
  return countrySeries(rows).get(selection) || [];
}

function renderSparklines(series) {
  const metrics = [
    ['screened', 'Screened'],
    ['randomized', 'Randomized'],
    ['screening', 'In Screening'],
    ['failed', 'Screen Failed'],
    ['eot', 'End of Treatment'],
  ];
  const container = document.getElementById('sparkline-grid');
  container.innerHTML = metrics.map(([key, label]) => {
    const vals = series.map(r => r[key] || 0);
    const path = sparklinePath(vals);
    const latest = vals.at(-1) ?? 0;
    const prev = vals.length > 1 ? vals.at(-2) : null;
    const cvdPercent = label === 'Randomized'
      ? series.at(-1)?.ecvd_randomized_percent
      : label === 'In Screening'
        ? series.at(-1)?.ecvd_screening_percent
        : null;
    return `
      <div class="summary-card summary-card-trend">
        <div class="summary-card-corner ${cvdPercent === null || cvdPercent === undefined ? 'hidden' : ''}">${cvdPercent === null || cvdPercent === undefined ? '' : `${cvdPercent}% eCVD`}</div>
        <div class="summary-label summary-label-full">${label}</div>
        <div class="summary-row">
          <div class="summary-main">
            <div class="summary-value">${latest}</div>
            <div class="delta ${((latest - (prev ?? latest)) >= 0) ? 'up' : 'down'}">Δ ${deltaText(latest, prev)}</div>
          </div>
          <svg viewBox="0 0 220 56" class="sparkline sparkline-side" preserveAspectRatio="none">
            <path d="${path}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </div>
      </div>
    `;
  }).join('');
}

function eCVDText(value) {
  return value === null || value === undefined ? '—' : `${value}%`;
}

function renderTrendTable(series) {
  const body = document.getElementById('history-body');
  if (!series.length) {
    body.innerHTML = '<tr><td colspan="13" class="muted">No history available for this view.</td></tr>';
    return;
  }
  const chron = series.map((r, idx) => {
    const prev = idx > 0 ? series[idx - 1] : null;
    return {
      ...r,
      deltas: {
        screened: deltaText(r.screened, prev?.screened),
        randomized: deltaText(r.randomized, prev?.randomized),
        screening: deltaText(r.screening, prev?.screening),
        failed: deltaText(r.failed, prev?.failed),
        eot: deltaText(r.eot, prev?.eot),
      },
    };
  });
  body.innerHTML = [...chron].reverse().map(r => `
      <tr>
        <td>${r.date}</td>
        <td class="number">${r.screened}</td>
        <td class="number delta-cell">${r.deltas.screened}</td>
        <td class="number">${r.randomized}</td>
        <td class="number delta-cell">${r.deltas.randomized}</td>
        <td class="number ecvd-cell ${r.ecvd_randomized_percent === null || r.ecvd_randomized_percent === undefined ? 'blank' : ''}">${eCVDText(r.ecvd_randomized_percent)}</td>
        <td class="number">${r.screening}</td>
        <td class="number delta-cell">${r.deltas.screening}</td>
        <td class="number ecvd-cell ${r.ecvd_screening_percent === null || r.ecvd_screening_percent === undefined ? 'blank' : ''}">${eCVDText(r.ecvd_screening_percent)}</td>
        <td class="number">${r.failed}</td>
        <td class="number delta-cell">${r.deltas.failed}</td>
        <td class="number">${r.eot}</td>
        <td class="number delta-cell">${r.deltas.eot}</td>
      </tr>
    `).join('');
}

function renderSelector(rows) {
  const select = document.getElementById('trend-select');
  const countries = [...countrySeries(rows).keys()].sort();
  select.innerHTML = [`<option value="__overall__">Overall</option>`]
    .concat(countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`))
    .join('');
}

function setCrossLinks(selection) {
  const sitesLink = document.getElementById('sites-link');
  if (!sitesLink) return;
  sitesLink.href = selection && selection !== '__overall__'
    ? `./sites.html?country=${encodeURIComponent(selection)}`
    : './sites.html';
}

function initialSelection(rows) {
  const requested = new URLSearchParams(window.location.search).get('country');
  if (!requested) return '__overall__';
  const countries = new Set(countrySeries(rows).keys());
  return countries.has(requested) ? requested : '__overall__';
}

function countrySiteSubtitle(country) {
  if (!currentSitesPayload || !country || country === '__overall__') return null;
  const rows = (currentSitesPayload.sites || []).filter((row) => row.country === country);
  const randomizedSites = rows.filter((row) => (row.randomized || 0) > 0).length;
  const randomizedSitesPct = rows.length ? Math.round((randomizedSites / rows.length) * 100) : 0;
  return `${rows.length} total sites · ${randomizedSites} sites with randomized patients (${randomizedSitesPct}%)`;
}

function renderView(rows, selection) {
  const title = document.getElementById('trend-title');
  const subtitle = document.getElementById('trend-subtitle');
  const series = metricsForSelection(rows, selection);
  setCrossLinks(selection);
  title.textContent = selection === '__overall__' ? 'Overall Trends' : `${selection} Trends`;
  subtitle.textContent = selection === '__overall__'
    ? randomizedAverageSubtitle(series)
    : `${countrySiteSubtitle(selection) || 'Country view'} · ${randomizedAverageSubtitle(series)}`;
  renderSparklines(series);
  renderTrendTable(series);
}

async function loadHistory() {
  const updated = document.getElementById('history-updated-at');
  try {
    const ts = Date.now();
    const [historyRes, currentRes] = await Promise.all([
      fetch(`./history_index.json?ts=${ts}`, { cache: 'no-store' }),
      fetch(`./data.json?ts=${ts}`, { cache: 'no-store' }),
    ]);
    if (!historyRes.ok) throw new Error(`HTTP ${historyRes.status}`);
    if (!currentRes.ok) throw new Error(`HTTP ${currentRes.status}`);
    const [rows, currentPayload] = await Promise.all([
      historyRes.json(),
      currentRes.json(),
    ]);
    currentSitesPayload = currentPayload;
    updated.textContent = `Loaded ${rows.length} stored snapshot${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) {
      document.getElementById('history-body').innerHTML = '<tr><td colspan="13" class="muted">No stored history yet.</td></tr>';
      return;
    }
    renderSelector(rows);
    const select = document.getElementById('trend-select');
    const selection = initialSelection(rows);
    select.value = selection;
    renderView(rows, selection);
    select.onchange = () => renderView(rows, select.value);
  } catch (err) {
    updated.textContent = 'History load failed';
    document.getElementById('history-body').innerHTML = `<tr><td colspan="13" class="muted">${esc(String(err))}</td></tr>`;
  }
}

loadHistory();
