(function (root) {
  const issues = [
    ["МКАОВокс01", "#276b51"], ["МКАОВокс02", "#d1a029"],
    ["МКАОВокс03", "#8b626e"], ["Воксис-01", "#468b9b"],
    ["Воксис-02", "#8b9a52"], ["Воксис-03", "#cc7054"],
    ["Воксис-04", "#6579a4"]
  ];
  const offers = [
    { alias: "Воксис-01", date: "2026-12-07", source: "https://www.e-disclosure.ru/portal/event.aspx?EventId=j4crP6Pt9U-Cd9nJu3wkZog-B-B" },
    { alias: "Воксис-03", date: "2026-12-19", source: "https://www.e-disclosure.ru/portal/event.aspx?EventId=WiLxLnLHIU63blMrDCAV4A-B-B" }
  ];
  const million = 1000000;
  const money = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
  const whole = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

  function rows(block) {
    if (!Array.isArray(block?.columns) || !Array.isArray(block?.data)) return [];
    return block.data.map((values) => Object.fromEntries(block.columns.map((key, i) => [key.toUpperCase(), values[i]])));
  }

  function finite(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalizeSchedule(json) {
    return {
      coupons: rows(json.coupons).map((row) => ({
        date: row.COUPONDATE, value: finite(row.VALUE), rate: finite(row.VALUEPRC)
      })).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date || "")),
      amortizations: rows(json.amortizations).map((row) => ({
        date: row.AMORTDATE, value: finite(row.VALUE)
      })).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date || "") && row.value !== null)
    };
  }

  function monthKey(date) { return date.slice(0, 7); }
  function daysBetween(start, end) {
    return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
  }

  function buildPaymentSeries(quotes, schedules, choices, reportDate, keyRate) {
    const payments = new Map();
    const warnings = [];
    let latestMaturity = reportDate;
    let estimated = false;
    for (const [alias] of issues) {
      const quote = quotes.find((item) => item.alias === alias);
      if (!quote || !quote.maturityDate || quote.maturityDate <= reportDate) continue;
      const count = finite(quote.placedSize);
      const currentFace = finite(quote.faceValue);
      if (!count || !currentFace) continue;
      if (quote.maturityDate > latestMaturity) latestMaturity = quote.maturityDate;
      const schedule = schedules[quote.secid];
      if (!schedule) { warnings.push(alias); continue; }

      const couponRows = [...schedule.coupons].sort((a, b) => a.date.localeCompare(b.date));
      const amortRows = [...schedule.amortizations].sort((a, b) => a.date.localeCompare(b.date));
      const initialFace = finite(quote.initialFaceValue);
      let remaining = initialFace === null ? currentFace : Math.max(0, initialFace - amortRows
        .filter((row) => row.date <= reportDate).reduce((sum, row) => sum + row.value, 0));
      if (!remaining) continue;
      const selectedOffer = offers.find((item) => item.alias === alias && choices[alias]
        && item.date > reportDate && item.date < quote.maturityDate);
      const endDate = selectedOffer?.date || quote.maturityDate;

      function add(date, kind, perBond) {
        if (!perBond || date <= reportDate || date > endDate) return;
        const key = monthKey(date);
        if (!payments.has(key)) payments.set(key, []);
        payments.get(key).push({ alias, kind, date, amount: perBond * count / million });
      }

      const eventDates = [...new Set([
        ...couponRows.map((row) => row.date), ...amortRows.map((row) => row.date), endDate
      ])].filter((date) => date > reportDate && date <= endDate).sort();
      for (const date of eventDates) {
        for (const coupon of couponRows.filter((row) => row.date === date)) {
          let value = coupon.value;
          if (value === null || value === 0) {
            const index = couponRows.indexOf(coupon);
            const previous = couponRows[index - 1]?.date;
            const period = previous ? daysBetween(previous, date) : finite(quote.couponPeriod) || 30;
            const rate = quote.secid === "RU000A10AC67"
              ? (keyRate === null ? null : keyRate + 7)
              : coupon.rate ?? finite(quote.couponPercent);
            if (rate !== null && period > 0 && period < 370) {
              value = Math.round(remaining * rate * period / 365) / 100;
              estimated = true;
            } else {
              warnings.push(alias);
            }
          }
          if (value !== null) add(date, "coupon", value);
        }
        for (const amort of amortRows.filter((row) => row.date === date)) {
          const principal = Math.min(remaining, amort.value);
          add(date, "principal", principal);
          remaining -= principal;
        }
        if (date === endDate && remaining > 0) {
          add(date, "principal", remaining);
          remaining = 0;
        }
      }
    }

    const months = [];
    let cursor = monthKey(reportDate);
    const last = monthKey(latestMaturity);
    while (cursor <= last && months.length < 120) {
      months.push({ key: cursor, segments: payments.get(cursor) || [] });
      const [year, month] = cursor.split("-").map(Number);
      cursor = `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}`;
    }
    return { months, warnings: [...new Set(warnings)], estimated };
  }

  function niceStep(maximum) {
    const raw = Math.max(1, maximum / 5);
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    return [1, 2, 5, 10].map((factor) => factor * magnitude).find((step) => step >= raw);
  }

  function renderSvg(series, logarithmic) {
    const months = series.months;
    const width = Math.max(920, 88 + months.length * 48);
    const height = 350;
    const top = 42, bottom = 34, left = 57, right = 18;
    const plotHeight = height - top - bottom;
    const totals = months.map((month) => month.segments.reduce((sum, item) => sum + item.amount, 0));
    const maximum = Math.max(1, ...totals);
    const step = niceStep(maximum);
    const ceiling = Math.ceil(maximum / step) * step;
    const transform = logarithmic ? (value) => Math.log10(value + 1) : (value) => value;
    const y = (value) => top + plotHeight * (1 - transform(value) / transform(ceiling));
    const ticks = logarithmic
      ? [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000].filter((value) => value <= ceiling)
      : Array.from({ length: Math.round(ceiling / step) + 1 }, (_, i) => i * step);
    const grid = ticks.map((value) => `<g class="cashflow-grid"><line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left - 9}" y="${y(value) + 4}" text-anchor="end">${whole.format(value)}</text></g>`).join("");
    const barWidth = 28;
    const bars = months.map((month, index) => {
      const center = left + 25 + index * 48;
      let cumulative = 0;
      const parts = month.segments.map((item) => {
        const from = cumulative;
        cumulative += item.amount;
        const barHeight = Math.max(0, y(from) - y(cumulative));
        if (!barHeight) return "";
        const color = issues.find(([alias]) => alias === item.alias)?.[1] || "#777";
        const label = `${item.alias} · ${item.kind === "coupon" ? "купон" : "номинал"} · ${item.date} · ${money.format(item.amount)} млн ₽`;
        return `<g><rect x="${center - barWidth / 2}" y="${y(cumulative)}" width="${barWidth}" height="${barHeight}" fill="${color}"/><rect x="${center - barWidth / 2}" y="${y(cumulative)}" width="${barWidth}" height="${barHeight}" fill="${item.kind === "coupon" ? "url(#couponHatch)" : "transparent"}"/><title>${label}</title></g>`;
      }).join("");
      const label = cumulative > 0 ? `<text class="cashflow-total" x="${center}" y="${Math.max(19, y(cumulative) - 7)}" text-anchor="middle">${whole.format(cumulative)}</text>` : "";
      const monthLabel = `<text class="cashflow-month" x="${center}" y="${height - 9}" text-anchor="middle">${month.key.slice(5)}/${month.key.slice(2, 4)}</text>`;
      return `${parts}${label}${monthLabel}`;
    }).join("");
    return `<svg class="cashflow-svg" role="img" aria-label="Помесячные выплаты по выпускам Воксис, млн рублей" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><defs><pattern id="couponHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="white" stroke-opacity=".75" stroke-width="2"/></pattern></defs><text class="cashflow-axis-title" x="${left}" y="18">млн ₽</text>${grid}${bars}</svg>`;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { normalizeSchedule, buildPaymentSeries, renderSvg };
  }
  if (typeof document === "undefined") return;

  const chart = document.querySelector("#cashflowChart");
  const status = document.querySelector("#cashflowStatus");
  const offerControls = document.querySelector("#cashflowOffers");
  const legend = document.querySelector("#cashflowLegend");
  const logToggle = document.querySelector("#cashflowLogToggle");
  if (!chart || !status || !offerControls || !legend || !logToggle) return;
  const schedules = {};
  const requests = new Map();
  const failedAt = new Map();
  const choices = {};
  let context = { quotes: [], date: "", keyRate: null };
  try { Object.assign(choices, JSON.parse(localStorage.getItem("voxys-monitor:offer-choices") || "{}")); } catch (_) {}

  function displayDate(iso) {
    const [year, month, day] = iso.split("-");
    return `${day}.${month}.${year}`;
  }

  function render() {
    const { quotes, date, keyRate } = context;
    if (!date) return;
    const activeOffers = offers.filter((offer) => {
      const quote = quotes.find((item) => item.alias === offer.alias);
      return quote?.placedSize && offer.date > date && offer.date < quote.maturityDate;
    });
    offerControls.innerHTML = activeOffers.map((offer) => `<label class="cashflow-offer"><input type="checkbox" data-alias="${offer.alias}" ${choices[offer.alias] ? "checked" : ""}><span>${offer.alias} · ${displayDate(offer.date)}</span><a href="${offer.source}" target="_blank" rel="noopener noreferrer" title="Условия оферты" aria-label="Условия оферты ${offer.alias}"><i data-lucide="external-link" aria-hidden="true"></i></a></label>`).join("");
    legend.innerHTML = issues.filter(([alias]) => quotes.some((item) => item.alias === alias && item.placedSize))
      .map(([alias, color]) => `<span class="cashflow-legend-item"><span class="cashflow-swatch" style="--issue-color:${color}"></span>${alias}</span>`).join("");
    const series = buildPaymentSeries(quotes, schedules, choices, date, keyRate);
    const hasPayments = series.months.some((month) => month.segments.length);
    chart.innerHTML = hasPayments ? renderSvg(series, logToggle.checked) : '<p class="cashflow-empty">Нет подтверждённого календаря выплат для выбранной даты.</p>';
    const missing = series.warnings.length ? `Не хватает данных: ${series.warnings.join(", ")}. ` : "";
    const estimate = series.estimated ? "Необъявленные купоны оценены по ставке на дату отчёта. " : "";
    status.textContent = `${requests.size ? "Загружаю календари MOEX. " : ""}${missing}${estimate}Объём в обращении взят из текущих данных MOEX.`;
    if (root.lucide) root.lucide.createIcons();
  }

  function loadSchedule(quote) {
    if (!quote.secid || requests.has(quote.secid) || Date.now() - (failedAt.get(quote.secid) || 0) < 10 * 60 * 1000) return;
    const key = `voxys-monitor:cashflow:${quote.secid}`;
    let saved;
    try { saved = JSON.parse(localStorage.getItem(key)); } catch (_) {}
    if (saved?.data) schedules[quote.secid] = saved.data;
    if (saved?.savedAt && Date.now() - saved.savedAt < 60 * 60 * 1000) return;
    const url = `https://iss.moex.com/iss/statistics/engines/stock/markets/bonds/bondization/${encodeURIComponent(quote.secid)}.json?iss.meta=off&iss.only=coupons,amortizations&limit=100`;
    const signal = AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
    const request = fetch(url, { signal }).then((response) => {
      if (!response.ok) throw new Error(`MOEX ${response.status}`);
      return response.json();
    }).then((json) => {
      const data = normalizeSchedule(json);
      if (!data.coupons.length && !data.amortizations.length) throw new Error("Пустой календарь");
      schedules[quote.secid] = data;
      try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })); } catch (_) {}
    }).catch(() => { failedAt.set(quote.secid, Date.now()); }).finally(() => { requests.delete(quote.secid); render(); });
    requests.set(quote.secid, request);
  }

  offerControls.addEventListener("change", (event) => {
    const alias = event.target.dataset?.alias;
    if (!alias) return;
    choices[alias] = event.target.checked;
    try { localStorage.setItem("voxys-monitor:offer-choices", JSON.stringify(choices)); } catch (_) {}
    render();
  });
  logToggle.addEventListener("change", render);
  root.VoxysCashflow = {
    update(quotes, date, keyRate) {
      context = { quotes, date, keyRate };
      for (const quote of quotes) {
        if (quote.placedSize && quote.maturityDate && quote.maturityDate > date) loadSchedule(quote);
      }
      render();
    }
  };
})(typeof window === "undefined" ? globalThis : window);
